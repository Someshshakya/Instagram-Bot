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

// Update constants for daily limits
const MAX_FOLLOWS = 140; // Daily target
const DAILY_LIMIT = 150; // Hard limit per day - NEVER exceed this
const MIN_FOLLOW_DELAY = 5000;
const MAX_FOLLOW_DELAY = 8000;
const RATE_LIMIT_DELAY = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 60000;

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
        const followersCollection = database.getCollection('followers');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Create a unique ID for today's document
        const todayId = today.toISOString().split('T')[0];

        // Get today's follow stats
        const todayStats = await followersCollection.findOne({ date: todayId });

        if (!todayStats) {
            // Create a new document for today
            await followersCollection.insertOne({
                date: todayId,
                followsCount: 1,
                lastUpdated: new Date(),
                startTime: new Date(),
                status: 'active',
                details: {
                    targetFollows: MAX_FOLLOWS,
                    dailyLimit: DAILY_LIMIT
                },
                history: [{
                    time: new Date(),
                    action: 'started',
                    followsCount: 1
                }]
            });
            log.stats(`Created new follow record for ${todayId}. First follow recorded.`);
            return;
        }

        // Check if we've hit the daily limit
        if (todayStats.followsCount >= DAILY_LIMIT) {
            await followersCollection.updateOne(
                { date: todayId },
                {
                    $set: {
                        status: 'completed',
                        lastUpdated: new Date()
                    },
                    $push: {
                        history: {
                            time: new Date(),
                            action: 'limit_reached',
                            followsCount: todayStats.followsCount
                        }
                    }
                }
            );
            log.warning(`🛑 Daily limit reached for ${todayId}. Total follows: ${todayStats.followsCount}`);
            throw new Error('DAILY_LIMIT_REACHED');
        }

        // Update today's document
        const newFollowCount = (todayStats.followsCount || 0) + 1;
        await followersCollection.updateOne(
            { date: todayId },
            {
                $set: {
                    followsCount: newFollowCount,
                    lastUpdated: new Date(),
                    status: newFollowCount >= DAILY_LIMIT ? 'completed' : 'active'
                },
                $push: {
                    history: {
                        time: new Date(),
                        action: 'follow',
                        followsCount: newFollowCount
                    }
                }
            }
        );

        // Log progress
        log.stats(`Updated follow count for ${todayId}:`);
        log.stats(`• Current follows: ${newFollowCount}/${DAILY_LIMIT}`);
        log.stats(`• Status: ${newFollowCount >= DAILY_LIMIT ? 'Completed' : 'Active'}`);

        // Add warning when approaching limit
        if (newFollowCount >= DAILY_LIMIT - 10) {
            log.warning(`⚠️ Approaching daily limit! (${newFollowCount}/${DAILY_LIMIT})`);
        }

    } catch (error) {
        if (error.message === 'DAILY_LIMIT_REACHED') {
            throw error;
        }
        log.error('Error updating follow count:', error.message);
        throw error;
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

async function checkDailyFollowStats() {
    try {
        const database = client.db('instagram_bot');
        const followersCollection = database.getCollection('followers');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayId = today.toISOString().split('T')[0];

        // Get today's stats
        const todayStats = await followersCollection.findOne({ date: todayId });

        if (!todayStats) {
            log.info('No follow activity recorded for today. Starting fresh.');
                                        return {
                followsToday: 0,
                canContinue: true
            };
        }

        // Get total follows (across all days)
        const totalFollows = await followersCollection.aggregate([
            { $group: { _id: null, total: { $sum: "$followsCount" } } }
        ]).toArray();

        const followsToday = todayStats.followsCount || 0;
        log.info(`📊 Follow Statistics for ${todayId}:`);
        log.info(`   • Follows today: ${followsToday}/${DAILY_LIMIT}`);
        log.info(`   • Total follows all time: ${totalFollows[0]?.total || 0}`);
        log.info(`   • Status: ${todayStats.status}`);
        log.info(`   • Last updated: ${new Date(todayStats.lastUpdated).toLocaleString()}`);

        if (followsToday >= DAILY_LIMIT) {
            log.warning(`🛑 Daily limit of ${DAILY_LIMIT} already reached for ${todayId}`);
            return {
                followsToday,
                canContinue: false
            };
        }

        return {
            followsToday,
            canContinue: true
        };
    } catch (error) {
        log.error('Error checking daily follow stats:', error.message);
        throw error;
    }
}

async function main() {
    let browser;
    let page;
    let sessionStartTime = new Date();

    try {
        log.info('🚀 Starting Instagram automation...');
        log.info(`⏱️ Session started at: ${sessionStartTime.toISOString()}`);

        // Connect to MongoDB first
        try {
            await client.connect();
            log.success('📦 Connected to MongoDB successfully');

            // Check current follow stats before proceeding
            const database = client.db('instagram_bot');
            const followersCollection = database.getCollection('followers');
            const stats = await followersCollection.findOne({ _id: 'followers_stats' });

            if (stats) {
                log.info(`📊 Current follow stats:`);
                log.info(`   • Follows today: ${stats.followsToday || 0}/${DAILY_LIMIT}`);
                log.info(`   • Total follows: ${stats.totalFollows || 0}`);

                if (stats.followsToday >= DAILY_LIMIT) {
                    log.warning(`🛑 Daily limit of ${DAILY_LIMIT} already reached. Cannot continue today.`);
                    await client.close();
                    process.exit(0);
                }
            }

            log.info(`🎯 Target: Follow maximum ${MAX_FOLLOWS} people (Hard limit: ${DAILY_LIMIT})`);
            log.info(`⚠️ Script will stop immediately if ${DAILY_LIMIT} follows is reached`);

        } catch (mongoError) {
            log.error('MongoDB Connection Error:', {
                message: mongoError.message,
                code: mongoError.code,
                name: mongoError.name
            });
            throw new Error(`Failed to connect to MongoDB: ${mongoError.message}`);
        }

        // Launch browser with custom window size
        browser = await puppeteer.launch({
            headless: isGitHubAction ? true : false,
            args: [
                '--window-size=1920,1080',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            executablePath: process.env.CHROME_PATH || undefined
        });

        // Create new page and set viewport
        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // Set up request interception for performance
        await setupRequestInterception(page);

        // Set custom user agent
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
        await page.setUserAgent(userAgent);
        log.info(`🌍 Using User-Agent: ${userAgent}`);

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

        while (stats.followsToday < MAX_FOLLOWS) {
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
            if (stats.followsToday >= MAX_FOLLOWS) break;

            // Refresh the page to load more followers
            log.info('Refreshing page to load more followers...');
            await page.reload({ waitUntil: 'networkidle0' });
            await randomDelay(3000, 5000);
        }

        // Final update to MongoDB
        await updateFollowCount(client.db('instagram_bot'), stats.followsToday);
        log.success(`Completed following ${stats.followsToday} users`);
        await browser.close();
        log.info('🌐 Browser closed. Script finished.');

    } catch (error) {
        if (error.message === 'DAILY_LIMIT_REACHED') {
            log.warning('🛑 Daily follow limit reached. Shutting down gracefully.');
            if (browser) await browser.close();
            await client.close();
            process.exit(0);
        }

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

        await client.close();
        process.exit(1);
    }
}

// Add process handlers for graceful shutdown
process.on('SIGINT', async () => {
    log.info('Received SIGINT. Performing graceful shutdown...');
    try {
        await client.close();
        log.info('MongoDB connection closed.');
        process.exit(0);
    } catch (error) {
        log.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    log.info('Received SIGTERM. Performing graceful shutdown...');
    try {
        await client.close();
        log.info('MongoDB connection closed.');
        process.exit(0);
    } catch (error) {
        log.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
});

main().catch(console.error); 