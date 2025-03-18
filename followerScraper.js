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
                const dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) {
                    resolve();
                    return;
                }

                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    const scrollHeight = dialog.scrollHeight;
                    dialog.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight - dialog.clientHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 200);
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

        // More specific selectors for Instagram follow buttons
        const buttonSelectors = [
            'button._acan._acap._acas',
            'button._acan._acap._acas._aj1-',
            'button[type="button"]._acan._acap._acas'
        ];

        let followButtons = [];

        // Try each selector
        for (const selector of buttonSelectors) {
            const buttons = await page.$$(selector);
            for (const button of buttons) {
                try {
                    const isDisabled = await button.evaluate(btn => btn.disabled || btn.getAttribute('disabled') !== null);
                    if (isDisabled) continue;

                    const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());
                    if (buttonText === 'follow') {
                        followButtons.push(button);
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
        await button.evaluate(btn => {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return new Promise(resolve => setTimeout(resolve, 500));
        });
        await randomDelay(1000, 2000);

        // Get button text before clicking
        const buttonText = await button.evaluate(btn => btn.textContent.trim().toLowerCase());

        if (buttonText !== 'follow') {
            throw new Error('Not a follow button');
        }

        // Click using JavaScript click()
        await button.evaluate(btn => btn.click());
        await randomDelay(2000, 3000);

        // Verify the follow action
        const newButtonText = await button.evaluate(btn => {
            const text = btn.textContent.trim().toLowerCase();
            return text;
        });

        if (newButtonText === 'following') {
            log.success('Successfully followed user');
            return true;
        } else {
            throw new Error('Follow action not confirmed');
        }
    } catch (error) {
        log.error('Error following user:', error.message);
        throw error;
    }
}

async function followUsers(page) {
    try {
        let followsToday = 0;
        let retryCount = 0;
        const maxRetries = 3;

        while (followsToday < MAX_FOLLOWS && retryCount < maxRetries) {
            const followButtons = await findFollowButtons(page);

            if (followButtons.length === 0) {
                log.info('No follow buttons found, scrolling to load more...');
                await scrollFollowersList(page);
                retryCount++;
                continue;
            }

            retryCount = 0; // Reset retry count when buttons are found

            for (const button of followButtons) {
                if (followsToday >= MAX_FOLLOWS) break;

                try {
                    const followed = await followUser(page, button);
                    if (followed) {
                        followsToday++;
                        await updateFollowCount(client.db('instagram_bot'), followsToday);
                        log.success(`Successfully followed user ${followsToday}/${MAX_FOLLOWS}`);
                        await randomDelay(3000, 5000);
                    }
                } catch (error) {
                    log.warning(`Failed to follow user: ${error.message}`);
                    await randomDelay(2000, 3000);
                    continue;
                }
            }

            // Scroll to load more buttons
            await scrollFollowersList(page);
            await randomDelay(2000, 3000);
        }

        return followsToday;
    } catch (error) {
        log.error(`Error in followUsers: ${error.message}`);
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

        // Launch browser with enhanced anti-detection measures
        log.browser('Launching browser with stealth mode...');

        // Check if running in GitHub Actions
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

        browser = await puppeteer.launch({
            headless: isGitHubActions ? 'new' : false, // Use new headless mode in GitHub Actions
            defaultViewport: {
                width: 375,
                height: 812
            },
            args: [
                '--start-maximized',
                '--disable-notifications',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=375,812',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--disable-extensions',
                '--disable-software-rasterizer',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--ignore-certificate-errors',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                '--disable-notifications',
                '--disable-default-apps',
                '--disable-popup-blocking',
                '--disable-save-password-bubble',
                '--disable-translate',
                '--disable-sync',
                '--disable-background-networking',
                '--metrics-recording-only',
                '--disable-default-apps',
                '--disable-popup-blocking',
                '--disable-save-password-bubble',
                '--disable-translate',
                '--disable-sync',
                '--disable-background-networking',
                '--metrics-recording-only',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-breakpad',
                '--disable-component-extensions-with-background-pages',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--force-color-profile=srgb',
                '--metrics-recording-only',
                '--no-default-browser-check',
                '--no-experiments',
                '--no-pings',
                '--no-zygote',
                '--password-store=basic',
                '--use-mock-keychain',
                '--use-gl=swiftshader',
                '--window-size=375,812'
            ]
        });

        log.success('🌐 Browser launched successfully');
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

        // Try to load cookies first
        const cookiesLoaded = await loadCookies(page);

        // Navigate to Instagram
        log.info('🌐 Navigating to Instagram...');
        await page.goto(INSTAGRAM_URL, { waitUntil: 'networkidle2' });
        await randomDelay(2000, 4000);

        // Only perform login if cookies weren't loaded successfully
        if (!cookiesLoaded) {
            // Navigate to login page
            await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
            await randomDelay(2000, 4000);

            // Perform login
            log.security('🔒 Starting login process...');
            await page.type('input[name="username"]', process.env.INSTAGRAM_USERNAME, { delay: 120 });
            await randomDelay(500, 1000);
            await page.type('input[name="password"]', process.env.INSTAGRAM_PASSWORD, { delay: 120 });
            await randomDelay(500, 1000);
            await page.click('button[type="submit"]');
            await randomDelay(3000, 5000);

            // Save cookies after successful login
            const cookies = await page.cookies();
            fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies));
            log.success('🍪 Cookies saved successfully');
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