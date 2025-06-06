const puppeteer = require('puppeteer');
const userAgent = require('user-agents');
const fs = require('fs');
require('dotenv').config();
const { MongoClient } = require('mongodb');
const log = require('./utils/logger');

// Validate required environment variables
const requiredEnvVars = ['MONGODB_URI', 'INSTAGRAM_USERNAME', 'INSTAGRAM_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
    process.exit(1);
}

// Constants for cookie management
const COOKIE_PATH = 'cookies.json';
const INSTAGRAM_URL = 'https://www.instagram.com/';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';

const MAX_FOLLOWS = 100;
const MIN_FOLLOW_DELAY = 5000;
const MAX_FOLLOW_DELAY = 8000;
const RATE_LIMIT_DELAY = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 60000;
const MAX_RUNTIME_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

// Use MongoDB URL from environment variables with fallback
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/instagram_bot';
const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000
});

// Add cookie loading function
async function loadCookies(page) {
    try {
        if (fs.existsSync(COOKIE_PATH)) {
            const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
            await page.setCookie(...cookies);
            log.success('🍪 Cookies loaded successfully');
            return true;
        }
    } catch (error) {
        log.error('Error loading cookies:', error.message);
    }
    return false;
}

// Update random delay function with longer delays
const randomDelay = async (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    log.debug(`Waiting for ${delay / 1000} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
};

async function loadSuggestionsPage(page) {
    log.info('Attempting to load followers from profile...');

    try {
        // First navigate to the profile page
        log.info('Navigating to profile page...');
        await page.goto('https://www.instagram.com/ms.sethii/', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        await randomDelay(2000, 3000);

        // Click on followers count to open the dialog
        log.info('Looking for followers link...');
        const followersSelectors = [
            'a[href$="/followers/"]',
            'a[href*="/followers"]',
            'a[href*="followers"]',
            'a:-webkit-any(href="/followers")',
            'a[role="link"]:has-text("followers")'
        ];

        let followersLink = null;
        for (const selector of followersSelectors) {
            try {
                followersLink = await page.waitForSelector(selector, { timeout: 5000 });
                if (followersLink) {
                    log.info(`Found followers link with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        if (!followersLink) {
            log.error('Could not find followers link');
            await page.screenshot({ path: 'no-followers-link.png', fullPage: true });
            return false;
        }

        // Click the followers link
        await followersLink.click();
        await randomDelay(3000, 5000);

        // Wait for followers list to load with multiple selectors
        const contentSelectors = [
            'div[role="dialog"]',
            'div[class*="x1lliihq"]',
            'div[class*="x1n2onr6"]',
            'div[class*="x1q0g3np"]',
            'div[role="list"]',
            'div[role="grid"]'
        ];

        let foundContent = false;
        for (const selector of contentSelectors) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 10000 });
                log.info(`Found content using selector: ${selector}`);
                foundContent = true;

                // Take a screenshot for debugging
                await page.screenshot({ path: 'followers-dialog.png', fullPage: true });

                // Get dialog content for debugging
                const dialogContent = await page.evaluate((sel) => {
                    const dialog = document.querySelector(sel);
                    return dialog ? {
                        innerHTML: dialog.innerHTML,
                        childCount: dialog.children.length,
                        classes: dialog.className
                    } : null;
                }, selector);
                log.debug('Dialog content:', JSON.stringify(dialogContent, null, 2));

                break;
            } catch (e) {
                continue;
            }
        }

        if (!foundContent) {
            log.error('Failed to load followers list');
            await page.screenshot({ path: 'followers-load-failed.png', fullPage: true });
            return false;
        }

        return true;
    } catch (error) {
        log.error('Error loading suggestions page:', error.message);
        await page.screenshot({ path: 'load-suggestions-error.png', fullPage: true });
        return false;
    }
}

async function loadSuggestedUsers(page) {
    log.info('Attempting to load suggested users...');

    try {
        // Navigate to Instagram explore/suggested page
        log.info('Navigating to suggestions page...');
        await page.goto('https://www.instagram.com/explore/people/suggested/', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        await randomDelay(2000, 3000);

        // Wait for the suggestions list to load
        const suggestionsSelectors = [
            'div[role="main"]',
            'div[data-pagelet="SuggestedUsers"]',
            'div[data-pagelet="MainFeed"]'
        ];

        let foundSuggestions = false;
        for (const selector of suggestionsSelectors) {
            try {
                await page.waitForSelector(selector, { visible: true, timeout: 5000 });
                log.info(`Found suggestions using selector: ${selector}`);
                foundSuggestions = true;
                break;
            } catch (e) {
                continue;
            }
        }

        if (!foundSuggestions) {
            log.error('Could not find suggestions list');
            await page.screenshot({ path: 'no-suggestions-found.png', fullPage: true });
            return false;
        }

        // Take a screenshot for debugging
        await page.screenshot({ path: 'suggestions-page.png', fullPage: true });
        return true;

    } catch (error) {
        log.error('Error loading suggestions page:', error.message);
        await page.screenshot({ path: 'load-suggestions-error.png', fullPage: true });
        return false;
    }
}

async function scrollFollowersList(page) {
    log.info('Scrolling followers list to load more...');

    try {
        await page.evaluate(() => {
            return new Promise((resolve) => {
                const dialog = document.querySelector('div[role="dialog"]') || document.querySelector('div[class*="x1n2onr6"]');
                if (!dialog) {
                    resolve();
                    return;
                }

                let previousHeight = dialog.scrollHeight;
                let scrollAttempts = 0;
                const maxScrollAttempts = 3;
                const distance = 300;

                const timer = setInterval(() => {
                    dialog.scrollBy(0, distance);

                    // Check if we've reached the bottom or if content hasn't loaded
                    if (dialog.scrollHeight === previousHeight) {
                        scrollAttempts++;
                        if (scrollAttempts >= maxScrollAttempts) {
                            clearInterval(timer);
                            resolve();
                            return;
                        }
                    } else {
                        scrollAttempts = 0;
                        previousHeight = dialog.scrollHeight;
                    }
                }, 200);

                // Set a maximum time for scrolling
                setTimeout(() => {
                    clearInterval(timer);
                    resolve();
                }, 5000);
            });
        });

        await randomDelay(2000, 3000);
        return true;
    } catch (error) {
        log.error('Error while scrolling followers list:', error.message);
        return false;
    }
}

async function findFollowButtons(page) {
    try {
        log.info('Looking for follow buttons...');

        // Updated selectors for Instagram follow buttons
        const buttonSelectors = [
            'button._acan._acap._acas',
            'button[type="button"]._acan._acap._acas',
            'button._ab1k._ab1l._ab1m',
            'button[class*="_acan"][class*="_acap"]',
            'button[class*="x1i10hfl"]',
            'button[class*="_acas"]:not([disabled])',
            'button[type="button"]:not([disabled])',
            'div[role="button"]'
        ];

        let followButtons = [];
        let debugInfo = {};

        // Try each selector
        for (const selector of buttonSelectors) {
            try {
                log.debug(`Trying selector: ${selector}`);
                const buttons = await page.$$(selector);
                log.debug(`Found ${buttons.length} elements with selector: ${selector}`);

                for (const button of buttons) {
                    try {
                        // Get button text and classes for debugging
                        const buttonInfo = await button.evaluate(btn => ({
                            text: btn.textContent.trim(),
                            classes: btn.className,
                            isVisible: {
                                display: window.getComputedStyle(btn).display,
                                visibility: window.getComputedStyle(btn).visibility,
                                rect: btn.getBoundingClientRect()
                            },
                            ariaLabel: btn.getAttribute('aria-label'),
                            role: btn.getAttribute('role'),
                            disabled: btn.disabled || btn.getAttribute('disabled') !== null
                        }));

                        log.debug(`Button info: ${JSON.stringify(buttonInfo)}`);

                        const isVisible = await button.evaluate(btn => {
                            const rect = btn.getBoundingClientRect();
                            const style = window.getComputedStyle(btn);
                            return rect.width > 0 &&
                                rect.height > 0 &&
                                style.display !== 'none' &&
                                style.visibility !== 'hidden' &&
                                style.opacity !== '0';
                        });

                        if (!isVisible) {
                            log.debug(`Button not visible: ${buttonInfo.text}`);
                            continue;
                        }

                        const isDisabled = buttonInfo.disabled;
                        if (isDisabled) {
                            log.debug(`Button disabled: ${buttonInfo.text}`);
                            continue;
                        }

                        // Check for follow text in button content or aria-label
                        const buttonText = buttonInfo.text.toLowerCase();
                        const ariaLabel = (buttonInfo.ariaLabel || '').toLowerCase();

                        if (buttonText.includes('follow') || ariaLabel.includes('follow')) {
                            // Additional check to exclude "following" and "unfollow" buttons
                            if (!buttonText.includes('following') && !buttonText.includes('unfollow') &&
                                !ariaLabel.includes('following') && !ariaLabel.includes('unfollow')) {
                                log.debug(`Valid follow button found: ${buttonInfo.text}`);
                                followButtons.push(button);
                            }
                        }

                        // Store debug info
                        debugInfo[selector] = debugInfo[selector] || [];
                        debugInfo[selector].push(buttonInfo);

                    } catch (error) {
                        log.debug(`Error processing button: ${error.message}`);
                        continue;
                    }
                }

                if (followButtons.length > 0) {
                    log.info(`Found ${followButtons.length} valid follow buttons with selector: ${selector}`);
                    break;
                }
            } catch (error) {
                log.debug(`Error with selector ${selector}: ${error.message}`);
                continue;
            }
        }

        // If no buttons found, take a screenshot and log debug info
        if (followButtons.length === 0) {
            log.info('No follow buttons found, saving debug information...');
            await page.screenshot({ path: 'no-buttons-found.png', fullPage: true });
            log.debug('Debug info for all buttons:', JSON.stringify(debugInfo, null, 2));

            // Get dialog content for debugging
            const dialogContent = await page.evaluate(() => {
                const dialog = document.querySelector('div[role="dialog"]') ||
                    document.querySelector('div[class*="x1n2onr6"]');
                if (dialog) {
                    return {
                        innerHTML: dialog.innerHTML,
                        childCount: dialog.children.length,
                        classes: dialog.className,
                        buttons: Array.from(dialog.querySelectorAll('button')).map(btn => ({
                            text: btn.textContent.trim(),
                            classes: btn.className,
                            ariaLabel: btn.getAttribute('aria-label'),
                            role: btn.getAttribute('role')
                        }))
                    };
                }
                return 'No dialog found';
            });
            log.debug('Dialog content:', dialogContent);
        }

        log.info(`Found ${followButtons.length} follow buttons`);
        return followButtons;
    } catch (error) {
        log.error('Error finding follow buttons:', error.message);
        return [];
    }
}

async function followUser(page, button) {
    try {
        // Scroll button into view
        log.debug('Scrolling button into view...');
        await button.evaluate(btn => {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return new Promise(resolve => setTimeout(resolve, 500));
        });
        await randomDelay(1000, 2000);

        // Get button text before clicking
        const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
        log.debug(`Initial button text: "${buttonText}"`);

        // More lenient check for follow button
        if (!buttonText.includes('follow')) {
            throw new Error(`Invalid button text: "${buttonText}"`);
        }

        // Click using JavaScript click()
        log.debug('Clicking follow button...');
        await button.evaluate(btn => btn.click());
        await randomDelay(2000, 3000);

        // More lenient verification of follow action
        const newButtonText = await button.evaluate(btn => {
            const text = btn.textContent.trim().toLowerCase();
            return text;
        });
        log.debug(`Button text after click: "${newButtonText}"`);

        // Check if the button text indicates following state
        if (newButtonText.includes('following') || newButtonText.includes('followed')) {
            log.success('✅ Follow action confirmed');
            return true;
        } else {
            // Check if button is still clickable (might indicate follow failed)
            const isClickable = await button.evaluate(btn => {
                const style = window.getComputedStyle(btn);
                return style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    !btn.disabled;
            });

            if (isClickable) {
                throw new Error(`Follow not confirmed. Button text: "${newButtonText}"`);
            } else {
                // Button is not clickable, might mean follow succeeded
                log.success('✅ Follow action likely succeeded (button no longer clickable)');
                return true;
            }
        }
    } catch (error) {
        log.error(`Follow action failed: ${error.message}`);
        // Check if button is still valid
        try {
            await button.evaluate(btn => btn.isConnected);
        } catch (e) {
            log.error('Button is no longer attached to DOM');
        }
        throw error;
    }
}

async function followUsers(page) {
    try {
        let followsToday = 0;
        let retryCount = 0;
        const maxRetries = 3;

        while (followsToday < MAX_FOLLOWS && retryCount < maxRetries) {
            log.info('Searching for follow buttons...');
            const followButtons = await findFollowButtons(page);

            if (followButtons.length === 0) {
                log.warning('No follow buttons found in current view');
                log.info('Attempting to scroll to load more buttons...');
                await scrollFollowersList(page);
                retryCount++;
                continue;
            }

            log.info(`Found ${followButtons.length} potential follow buttons to process`);
            retryCount = 0; // Reset retry count when buttons are found

            for (const button of followButtons) {
                if (followsToday >= MAX_FOLLOWS) {
                    log.info('Reached maximum follow limit for today');
                    break;
                }

                try {
                    log.info('Attempting to follow user...');

                    // Get button text before clicking
                    const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
                    log.debug(`Button text before click: "${buttonText}"`);

                    // Get username if possible
                    try {
                        const username = await page.evaluate(btn => {
                            const userElement = btn.closest('div[role="button"]')?.querySelector('span') ||
                                btn.closest('div[role="listitem"]')?.querySelector('span');
                            return userElement ? userElement.textContent.trim() : 'unknown user';
                        }, button);
                        log.info(`Attempting to follow ${username}`);
                    } catch (e) {
                        log.debug('Could not get username');
                    }

                    const followed = await followUser(page, button);

                    if (followed) {
                        followsToday++;
                        await updateFollowCount(client.db('instagram_bot'), followsToday);
                        log.success(`✅ Follow successful! Progress: ${followsToday}/${MAX_FOLLOWS}`);

                        // Verify the button state after following
                        try {
                            const newButtonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
                            log.debug(`Button text after click: "${newButtonText}"`);
                        } catch (e) {
                            log.debug('Could not verify button text after click');
                        }

                        // Add a longer delay between successful follows
                        const delay = Math.floor(Math.random() * (MAX_FOLLOW_DELAY - MIN_FOLLOW_DELAY + 1)) + MIN_FOLLOW_DELAY;
                        log.info(`Waiting ${delay / 1000} seconds before next follow...`);
                        await randomDelay(delay, delay + 2000);
                    } else {
                        log.warning('Follow action did not complete successfully');
                    }
                } catch (error) {
                    log.warning(`Failed to follow user: ${error.message}`);
                    // Take a screenshot on error
                    try {
                        await page.screenshot({ path: `follow-error-${Date.now()}.png`, fullPage: true });
                        log.info('Error screenshot saved');
                    } catch (e) { }
                    await randomDelay(2000, 3000);
                    continue;
                }
            }

            // After processing all buttons in view, scroll to load more
            log.info('Scrolling to load more follow buttons...');
            await scrollFollowersList(page);
            await randomDelay(2000, 3000);
        }

        if (followsToday >= MAX_FOLLOWS) {
            log.success(`🎉 Successfully completed following ${followsToday} users!`);
        } else if (retryCount >= maxRetries) {
            log.warning(`Stopped after ${followsToday} follows due to maximum retry limit`);
        }

        return followsToday;
    } catch (error) {
        log.error(`Error in followUsers: ${error.message}`);
        log.error(error.stack);
        throw error;
    }
}

async function safeNavigate(page, url, options = {}) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            await page.goto(url, {
                waitUntil: 'networkidle0',
                timeout: 60000,
                ...options
            });

            // Check for rate limit error
            const content = await page.content();
            if (content.includes('HTTP ERROR 429') || content.includes('Too Many Requests')) {
                await handleRateLimit(page);
                retries++;
                continue;
            }

            return true;
        } catch (error) {
            log.error(`Navigation attempt ${retries + 1} failed:`, error.message);
            retries++;
            if (retries < MAX_RETRIES) {
                await page.waitForTimeout(RETRY_DELAY);
            }
        }
    }
    return false;
}

async function handleRateLimit(page) {
    log.info('Rate limit detected, waiting...');
    await page.waitForTimeout(RETRY_DELAY);
    return true;
}

async function updateFollowCount(database, count) {
    try {
        const followersCollection = database.collection('followers');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get current stats from followers collection
        const currentStats = await followersCollection.findOne({ _id: 'followers_stats' }) || {};
        const lastUpdate = currentStats.lastUpdated ? new Date(currentStats.lastUpdated) : null;

        // Reset followsToday if it's a new day
        if (!lastUpdate || lastUpdate < today) {
            await followersCollection.updateOne(
                { _id: 'followers_stats' },
                {
                    $set: {
                        lastUpdated: new Date(),
                        totalFollows: count,
                        followsToday: 1,
                        lastResetDate: today,
                        todayDate: today  // Set todayDate when starting to follow
                    }
                },
                { upsert: true }
            );
            log.stats(`Reset daily counter. New follows today: 1`);
        } else {
            // Update existing stats
            await followersCollection.updateOne(
                { _id: 'followers_stats' },
                {
                    $set: {
                        lastUpdated: new Date(),
                        totalFollows: count,
                        todayDate: today  // Update todayDate with each follow
                    },
                    $inc: {
                        followsToday: 1
                    }
                },
                { upsert: true }
            );
            log.stats(`Updated follow count in MongoDB: ${count}, follows today: ${(currentStats.followsToday || 0) + 1}`);
        }
    } catch (error) {
        log.error('Error updating follow count:', error.message);
    }
}

async function performLogin(page) {
    try {
        log.security('🔒 Starting login process...');

        // Wait for login form
        await page.waitForSelector('input[name="username"]', { visible: true, timeout: 10000 });
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });

        // Clear any existing input
        await page.evaluate(() => {
            document.querySelector('input[name="username"]').value = '';
            document.querySelector('input[name="password"]').value = '';
        });

        // Type credentials with human-like delays
        for (const char of process.env.INSTAGRAM_USERNAME) {
            await page.type('input[name="username"]', char, { delay: Math.random() * 100 + 50 });
        }
        await randomDelay(500, 1000);

        for (const char of process.env.INSTAGRAM_PASSWORD) {
            await page.type('input[name="password"]', char, { delay: Math.random() * 100 + 50 });
        }
        await randomDelay(500, 1000);

        // Click login button
        const loginButton = await page.waitForSelector('button[type="submit"]', { visible: true, timeout: 5000 });
        await loginButton.click();

        // Wait for navigation and check for various post-login scenarios
        await Promise.race([
            page.waitForSelector('svg[aria-label="Home"]', { visible: true, timeout: 10000 }),
            page.waitForSelector('input[name="verificationCode"]', { visible: true, timeout: 10000 }),
            page.waitForSelector('button:has-text("Not Now")', { visible: true, timeout: 10000 })
        ]);

        // Check for security checkpoint
        const securityCheck = await page.$('input[name="verificationCode"]');
        if (securityCheck) {
            throw new Error('Security checkpoint detected! Please check your email/phone for verification code.');
        }

        // Handle "Save Login Info" popup
        try {
            const notNowButton = await page.waitForSelector('button:has-text("Not Now")', { timeout: 5000 });
            if (notNowButton) {
                await notNowButton.click();
                await randomDelay(1000, 2000);
            }
        } catch (e) { }

        // Handle notifications popup
        try {
            const notNowButton = await page.waitForSelector('button:has-text("Not Now")', { timeout: 5000 });
            if (notNowButton) {
                await notNowButton.click();
                await randomDelay(1000, 2000);
            }
        } catch (e) { }

        // Save cookies after successful login
        const cookies = await page.cookies();
        fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies));
        log.success('🍪 Cookies saved successfully');

        return true;
    } catch (error) {
        log.error('Login failed:', error.message);
        await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        throw error;
    }
}

async function main() {
    let browser;
    let page;
    let followCount = 0;
    let lastFollowedUser = null;
    let sessionStartTime = new Date();
    let shouldStop = false;

    try {
        log.info('🚀 Starting Instagram automation...');
        log.info(`🎯 Target: Follow maximum ${MAX_FOLLOWS} people`);
        log.info(`⏱️ Session started at: ${sessionStartTime.toISOString()}`);
        log.info(`⏰ Will run for maximum ${MAX_RUNTIME_MS / (60 * 1000)} minutes`);

        // Add timer to stop after 15 minutes
        setTimeout(() => {
            shouldStop = true;
            log.info('⏰ Time limit reached (15 minutes). Will stop after current operation completes.');
        }, MAX_RUNTIME_MS);

        // Connect to MongoDB with detailed error handling
        try {
            log.info(`Attempting to connect to MongoDB at: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
            await client.connect();
            log.success('📦 Connected to MongoDB successfully');
        } catch (mongoError) {
            log.error('MongoDB Connection Error:', {
                message: mongoError.message,
                code: mongoError.code,
                name: mongoError.name,
                stack: mongoError.stack
            });
            throw new Error(`Failed to connect to MongoDB: ${mongoError.message}`);
        }

        const database = client.db('instagram_bot');
        const followersCollection = database.collection('followers');

        // Get current follow count from followers collection with error handling
        try {
            const stats = await followersCollection.findOne({ _id: 'followers_stats' });
            if (stats) {
                followCount = stats.totalFollows || 0;
                log.info(`📊 Current follow count from MongoDB: ${followCount}`);
                log.info(`📊 Follows today: ${stats.followsToday || 0}`);
            }
        } catch (statsError) {
            log.error('Error fetching stats from MongoDB:', {
                message: statsError.message,
                code: statsError.code,
                name: statsError.name,
                stack: statsError.stack
            });
        }

        // Check if running in GitHub Actions
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
        log.info(`Running in ${isGitHubActions ? 'GitHub Actions' : 'local'} environment`);

        // Launch browser with basic configuration
        log.browser('Launching browser...');

        try {
            const launchOptions = {
                headless: isGitHubActions,
                executablePath: process.env.CHROME_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--window-size=1280,720'
                ]
            };

            log.info('Browser launch options configured, attempting to launch...');
            browser = await puppeteer.launch(launchOptions);
            log.success('🌐 Browser launched successfully');

            // Create a new page
            page = await browser.newPage();

            // Set a custom user agent
            const userAgentString = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
            await page.setUserAgent(userAgentString);
            log.browser(`🌍 Using User-Agent: ${userAgentString}`);

            // Set viewport
            await page.setViewport({
                width: 1280,
                height: 720,
                deviceScaleFactor: 1
            });

            // Basic anti-detection
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
                window.navigator.chrome = { runtime: {} };
            });

        } catch (launchError) {
            log.error('Failed to launch browser:', launchError.message);
            log.error('Launch error details:', {
                errorName: launchError.name,
                errorMessage: launchError.message,
                errorStack: launchError.stack,
                isGitHubActions,
                chromePath: process.env.CHROME_PATH
            });
            throw launchError;
        }

        // Navigate to Instagram and perform login
        log.info('🌐 Navigating to Instagram...');
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        await randomDelay(2000, 4000);

        // Try to load cookies first
        const cookiesLoaded = await loadCookies(page);

        // Only perform login if cookies weren't loaded successfully
        if (!cookiesLoaded) {
            await performLogin(page);
        }

        while (followCount < MAX_FOLLOWS && !shouldStop) {
            // First try followers page
            log.info('Navigating to followers page...');
            const followersLoaded = await loadSuggestionsPage(page);

            if (followersLoaded) {
                await scrollFollowersList(page);
                const followButtons = await findFollowButtons(page);

                if (followButtons.length === 0) {
                    log.info('No follow buttons found in followers list, switching to suggestions...');
                    // Try suggestions page instead
                    const suggestionsLoaded = await loadSuggestedUsers(page);
                    if (suggestionsLoaded) {
                        await followUsers(page);
                    } else {
                        log.error('Failed to load both followers and suggestions');
                        break;
                    }
                } else {
                    // Follow users from followers list
                    await followUsers(page);
                }
            } else {
                log.info('Failed to load followers page, trying suggestions instead...');
                const suggestionsLoaded = await loadSuggestedUsers(page);
                if (suggestionsLoaded) {
                    await followUsers(page);
                } else {
                    log.error('Failed to load both followers and suggestions');
                    break;
                }
            }

            // Check if we should stop
            if (shouldStop) {
                log.info('⏰ Time limit reached. Stopping gracefully...');
                break;
            }

            // If we've reached the max follows, break the loop
            if (followCount >= MAX_FOLLOWS) break;

            // Refresh the page to load more users
            log.info('Refreshing page to load more users...');
            await page.reload({ waitUntil: 'networkidle0' });
            await randomDelay(3000, 5000);
        }

        // Final update to MongoDB
        await updateFollowCount(database, followCount);
        const runTime = (new Date() - sessionStartTime) / 1000 / 60; // in minutes
        log.success(`Completed following ${followCount} users in ${runTime.toFixed(2)} minutes`);
        await browser.close();
        log.info('🌐 Browser closed. Script finished.');

    } catch (error) {
        log.error('❌ An error occurred:', error.message);
        log.error('Stack trace:', error.stack);

        if (page) {
            await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
            log.info('📸 Error screenshot saved as error-screenshot.png');
        }

        if (browser) {
            await browser.close();
            log.info('🌐 Browser closed after error.');
        }
        process.exit(1);
    } finally {
        await client.close();
        log.info('📦 MongoDB connection closed');
    }
}

main().catch(console.error); 