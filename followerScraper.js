const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userAgent = require('user-agents');
const fs = require('fs');
require('dotenv').config();
const { MongoClient } = require('mongodb');

// Initialize puppeteer with StealthPlugin
puppeteer.use(StealthPlugin());

// Constants for cookie management
const COOKIE_PATH = 'cookies.json';
const INSTAGRAM_URL = 'https://www.instagram.com/';
const LOGIN_URL = 'https://www.instagram.com/accounts/login/';

// Enhanced logging function with timestamps and emojis
const log = {
    info: (message) => console.log(`[INSTA-BOT] ℹ️ ${new Date().toISOString()} - ${message}`),
    success: (message) => console.log(`[INSTA-BOT] ✅ ${new Date().toISOString()} - ${message}`),
    warning: (message) => console.log(`[INSTA-BOT] ⚠️ ${new Date().toISOString()} - ${message}`),
    error: (message) => console.error(`[INSTA-BOT] ❌ ${new Date().toISOString()} - ${message}`),
    debug: (message) => console.log(`[INSTA-BOT] 🔍 ${new Date().toISOString()} - ${message}`),
    stats: (message) => console.log(`[INSTA-BOT] 📊 ${new Date().toISOString()} - ${message}`),
    security: (message) => console.log(`[INSTA-BOT] 🔒 ${new Date().toISOString()} - ${message}`),
    browser: (message) => console.log(`[INSTA-BOT] 🌐 ${new Date().toISOString()} - ${message}`)
};

// Use MongoDB URL from environment variables with fallback
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/instagram_bot';
const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000
});

const MAX_FOLLOWS = 100;
const MIN_FOLLOW_DELAY = 5000;
const MAX_FOLLOW_DELAY = 8000;
const RATE_LIMIT_DELAY = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 60000;

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

    // Navigate to the specific profile's followers page
    const success = await safeNavigate(page, 'https://www.instagram.com/ms.sethii/followers/');
    if (!success) {
        log.error('Failed to load followers page');
        return false;
    }

    // Wait for followers list to load
    await randomDelay(3000, 5000);

    // Wait for content to load with multiple selectors
    const contentSelectors = [
        'div[role="dialog"]',
        'div[class*="x1lliihq"]',
        'div[class*="x1n2onr6"]',
        'div[class*="x1q0g3np"]',
        'div[role="list"]',
        'div[role="grid"]'
    ];

    for (const selector of contentSelectors) {
        try {
            await page.waitForSelector(selector, { visible: true, timeout: 10000 });
            log.info(`Found content using selector: ${selector}`);
            return true;
        } catch (e) {
            continue;
        }
    }

    log.error('Failed to load followers list');
    await page.screenshot({ path: 'followers-load-failed.png', fullPage: true });
    return false;
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
            'button._acan._acap._acas._aj1-',
            'button[type="button"]._acan._acap._acas',
            'button:has-text("Follow")',
            'button[class*="x1i10hfl"][class*="_acan"]',
            'button[class*="x1n2onr6"][class*="_acan"]',
            'button[class*="_acap"][class*="_acan"]'
        ];

        let followButtons = [];

        // Try each selector
        for (const selector of buttonSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                const buttons = await page.$$(selector);

                for (const button of buttons) {
                    try {
                        const isVisible = await button.evaluate(btn => {
                            const rect = btn.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 &&
                                window.getComputedStyle(btn).display !== 'none' &&
                                window.getComputedStyle(btn).visibility !== 'hidden';
                        });

                        if (!isVisible) continue;

                        const isDisabled = await button.evaluate(btn =>
                            btn.disabled ||
                            btn.getAttribute('disabled') !== null ||
                            btn.classList.contains('_acat')  // Instagram's disabled button class
                        );

                        if (isDisabled) continue;

                        const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
                        if (buttonText === 'follow') {
                            followButtons.push(button);
                        }
                    } catch (error) {
                        continue;
                    }
                }

                if (followButtons.length > 0) {
                    break; // Exit if we found valid buttons
                }
            } catch (error) {
                continue; // Try next selector if current one fails
            }
        }

        // If no buttons found, try scrolling and searching again
        if (followButtons.length === 0) {
            log.info('No follow buttons found, scrolling to load more...');
            await scrollFollowersList(page);
            await randomDelay(2000, 3000);

            // Try one more time after scrolling
            for (const selector of buttonSelectors) {
                try {
                    const buttons = await page.$$(selector);
                    for (const button of buttons) {
                        try {
                            const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
                            const isDisabled = await button.evaluate(btn =>
                                btn.disabled ||
                                btn.getAttribute('disabled') !== null ||
                                btn.classList.contains('_acat')
                            );

                            if (!isDisabled && buttonText === 'follow') {
                                followButtons.push(button);
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                } catch (error) {
                    continue;
                }
            }
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

        if (buttonText !== 'follow') {
            throw new Error(`Invalid button text: "${buttonText}"`);
        }

        // Click using JavaScript click()
        log.debug('Clicking follow button...');
        await button.evaluate(btn => btn.click());
        await randomDelay(2000, 3000);

        // Verify the follow action
        const newButtonText = await button.evaluate(btn => {
            const text = btn.textContent.trim().toLowerCase();
            return text;
        });
        log.debug(`Button text after click: "${newButtonText}"`);

        if (newButtonText === 'following') {
            log.success('✅ Follow action confirmed');
            return true;
        } else {
            throw new Error(`Follow not confirmed. Button text: "${newButtonText}"`);
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

    try {
        log.info('🚀 Starting Instagram automation...');
        log.info(`🎯 Target: Follow maximum ${MAX_FOLLOWS} people`);
        log.info(`⏱️ Session started at: ${sessionStartTime.toISOString()}`);

        // Connect to MongoDB
        await client.connect();
        const database = client.db('instagram_bot');
        const followersCollection = database.collection('followers');
        log.success('📦 Connected to MongoDB successfully');

        // Get current follow count from followers collection
        const stats = await followersCollection.findOne({ _id: 'followers_stats' });
        if (stats) {
            followCount = stats.totalFollows || 0;
            log.info(`📊 Current follow count from MongoDB: ${followCount}`);
            log.info(`📊 Follows today: ${stats.followsToday || 0}`);
        }

        // Check if running in GitHub Actions
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
        log.info(`Running in ${isGitHubActions ? 'GitHub Actions' : 'local'} environment`);

        // Launch browser with enhanced anti-detection measures
        log.browser('Launching browser with stealth mode...');

        try {
            const launchOptions = {
                headless: isGitHubActions ? 'new' : false,
                executablePath: process.env.CHROME_PATH || undefined,
                defaultViewport: {
                    width: 375,
                    height: 812,
                    deviceScaleFactor: 2,
                    isMobile: true,
                    hasTouch: true
                },
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=375,812',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--disable-notifications',
                    '--disable-default-apps',
                    '--disable-extensions',
                    '--disable-sync',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=ScriptStreaming',
                    '--enable-automation',
                    '--ignore-certificate-errors',
                    '--no-first-run'
                ]
            };

            // Add additional arguments for GitHub Actions environment
            if (isGitHubActions) {
                launchOptions.args.push(
                    '--single-process',
                    '--no-zygote',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-canvas-aa',
                    '--disable-2d-canvas-clip-aa',
                    '--disable-gl-drawing-for-tests',
                    '--disable-software-rasterizer',
                    '--mute-audio',
                    '--disable-background-networking',
                    '--disable-default-apps',
                    '--disable-extensions',
                    '--disable-sync',
                    '--disable-translate',
                    '--hide-scrollbars',
                    '--metrics-recording-only',
                    '--no-sandbox',
                    '--no-startup-window',
                    '--deterministic-fetch',
                    '--remote-debugging-port=9222'
                );
            }

            browser = await puppeteer.launch(launchOptions);
            log.success('🌐 Browser launched successfully');
        } catch (launchError) {
            log.error('Failed to launch browser:', launchError.message);
            if (launchError.message.includes('ENOENT')) {
                log.error('Chrome executable not found. Please ensure Chrome is installed or set CHROME_PATH environment variable.');
            }
            throw launchError;
        }

        page = await browser.newPage();

        // Generate and set a mobile User-Agent
        const mobileUserAgent = new userAgent({ deviceCategory: 'mobile' });
        await page.setUserAgent(mobileUserAgent.toString());
        log.browser(`🌍 Using User-Agent: ${mobileUserAgent.toString()}`);

        // Set mobile viewport
        await page.setViewport({
            width: 375,
            height: 812,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true
        });

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

        while (followCount < MAX_FOLLOWS) {
            // Step 1: Load followers page
            log.info('Navigating to followers page...');
            const followersLoaded = await loadSuggestionsPage(page);
            if (!followersLoaded) {
                throw new Error('Failed to load followers page');
            }

            // Step 2: Scroll to load more followers
            await scrollFollowersList(page);

            // Step 3: Find and follow users
            await followUsers(page);

            // If we've reached the max follows, break the loop
            if (followCount >= MAX_FOLLOWS) break;

            // Refresh the page to load more followers
            log.info('Refreshing page to load more followers...');
            await page.reload({ waitUntil: 'networkidle0' });
            await randomDelay(3000, 5000);
        }

        // Final update to MongoDB
        await updateFollowCount(database, followCount);
        log.success(`Completed following ${followCount} users`);
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