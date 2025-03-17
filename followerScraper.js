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

const MAX_FOLLOWS = 100; // Maximum number of people to follow
const MIN_FOLLOW_DELAY = 10000; // Minimum delay between follows (10 seconds)
const MAX_FOLLOW_DELAY = 15000; // Maximum delay between follows (15 seconds)

// Random delay function to make actions more human-like
const randomDelay = async (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    log.debug(`Waiting for ${Math.round(delay / 1000)} seconds...`);
    await new Promise(resolve => setTimeout(resolve, delay));
};

// Function to save session state
const saveSessionState = async (followCount, lastFollowedUser) => {
    try {
        const sessionState = {
            timestamp: new Date().toISOString(),
            followCount,
            lastFollowedUser,
            browserInfo: {
                userAgent: await page.evaluate(() => navigator.userAgent),
                platform: await page.evaluate(() => navigator.platform),
                language: await page.evaluate(() => navigator.language)
            }
        };
        fs.writeFileSync('session-state.json', JSON.stringify(sessionState, null, 2));
        log.debug('Session state saved successfully');
    } catch (error) {
        log.error('Failed to save session state:', error.message);
    }
};

(async () => {
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

        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        // Launch browser with enhanced anti-detection measures
        log.browser('Launching browser with stealth mode...');
        const isCI = process.env.CI === 'true';
        log.debug('Environment:', {
            isCI,
            chromePath: process.env.CHROME_PATH,
            proxy: process.env.PROXY ? 'Configured' : 'Not configured'
        });

        browser = await puppeteer.launch({
            headless: isCI ? 'new' : false,
            defaultViewport: {
                width: 1920,
                height: 1080
            },
            args: [
                '--start-maximized',
                '--disable-notifications',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-blink-features=AutomationControlled',
                ...(process.env.PROXY ? [`--proxy-server=${process.env.PROXY}`] : []),
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ],
            executablePath: isCI ? process.env.CHROME_PATH : undefined,
            ignoreHTTPSErrors: true
        });

        log.success('🌐 Browser launched successfully');
        page = await browser.newPage();

        // Generate and set a new User-Agent dynamically
        const newUserAgent = new userAgent();
        await page.setUserAgent(newUserAgent.toString());
        log.browser(`🌍 Using User-Agent: ${newUserAgent.toString()}`);

        // Enhanced anti-detection measures
        await page.evaluateOnNewDocument(() => {
            // Overwrite the `navigator.webdriver` property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false
            });

            // Overwrite the `navigator.plugins` property
            Object.defineProperty(navigator, 'plugins', {
                get: () => [
                    {
                        0: {
                            type: "application/x-google-chrome-pdf",
                            suffixes: "pdf",
                            description: "Portable Document Format",
                            enabledPlugin: true
                        },
                        description: "Portable Document Format",
                        filename: "internal-pdf-viewer",
                        length: 1,
                        name: "Chrome PDF Plugin"
                    }
                ]
            });

            // Add language preferences
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en']
            });

            // Modify the permissions API
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            // Add Chrome runtime
            window.chrome = {
                runtime: {}
            };
        });

        // Load cookies if available
        if (fs.existsSync(COOKIE_PATH)) {
            try {
                const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH));
                await page.setCookie(...cookies);
                log.security('✅ Cookies loaded successfully!');
                log.debug(`Loaded ${cookies.length} cookies`);
            } catch (error) {
                log.warning('Failed to load cookies:', error.message);
            }
        }

        // Navigate to Instagram
        log.info('🌐 Navigating to Instagram...');
        await page.goto(INSTAGRAM_URL, { waitUntil: 'networkidle2' });

        // Enhanced login state check
        let loginRequired = false;
        try {
            // Wait for either login form or home icon
            const loginState = await Promise.race([
                page.waitForSelector('input[name="username"]', { timeout: 5000 })
                    .then(() => ({ state: 'login_required' })),
                page.waitForSelector('svg[aria-label="Home"]', { timeout: 5000 })
                    .then(() => ({ state: 'logged_in' })),
                page.waitForSelector('div[role="dialog"]', { timeout: 5000 })
                    .then(() => ({ state: 'dialog' }))
            ]).catch(() => ({ state: 'unknown' }));

            log.debug('Login state check result:', loginState);

            switch (loginState.state) {
                case 'login_required':
                    loginRequired = true;
                    log.info('🔒 Login required - no valid session found');
                    break;
                case 'logged_in':
                    log.success('✅ Successfully verified logged in state');
                    break;
                case 'dialog':
                    const dialogText = await page.evaluate(() => {
                        const dialog = document.querySelector('div[role="dialog"]');
                        return dialog ? dialog.textContent : '';
                    });
                    log.warning(`⚠️ Found dialog: ${dialogText}`);
                    loginRequired = true;
                    break;
                case 'unknown':
                    log.warning('⚠️ Could not determine login state, proceeding with login');
                    loginRequired = true;
                    break;
            }

            // Additional verification of login state
            if (!loginRequired) {
                try {
                    // Try to access profile page to verify login
                    await page.goto(`https://www.instagram.com/${process.env.INSTAGRAM_USERNAME}/`, { waitUntil: 'networkidle2' });
                    await page.waitForSelector('svg[aria-label="Home"]', { timeout: 5000 });
                    log.success('✅ Login state verified through profile access');
                } catch (error) {
                    log.warning('⚠️ Failed to verify login through profile access, proceeding with login');
                    loginRequired = true;
                }
            }
        } catch (error) {
            log.error('❌ Error checking login state:', error.message);
            loginRequired = true;
        }

        if (loginRequired) {
            log.security('🔒 Starting login process...');
            await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });

            // Clear any existing cookies
            await page.deleteCookie();
            log.debug('Cleared existing cookies');

            // Enter credentials with realistic typing delay
            await page.type('input[name="username"]', process.env.INSTAGRAM_USERNAME, { delay: 120 });
            await page.type('input[name="password"]', process.env.INSTAGRAM_PASSWORD, { delay: 120 });

            // Wait a bit before clicking login
            await randomDelay(1000, 2000);

            await page.click('button[type="submit"]');

            // Wait for login process with better error handling
            try {
                await Promise.race([
                    page.waitForSelector('svg[aria-label="Home"]', { timeout: 30000 }),
                    page.waitForSelector('input[name="verificationCode"]', { timeout: 30000 })
                        .then(() => { throw new Error('Verification code required'); }),
                    page.waitForSelector('p[data-testid="login-error-message"]', { timeout: 30000 })
                        .then(async () => {
                            const errorText = await page.evaluate(() => {
                                const error = document.querySelector('p[data-testid="login-error-message"]');
                                return error ? error.textContent : 'Unknown error';
                            });
                            throw new Error(`Login error: ${errorText}`);
                        })
                ]);

                // Save cookies after successful login
                const cookies = await page.cookies();
                fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies));
                log.security('✅ Login successful! Cookies saved.');
                log.debug(`Saved ${cookies.length} cookies`);

                // Verify login state one more time
                await page.goto(INSTAGRAM_URL, { waitUntil: 'networkidle2' });
                await page.waitForSelector('svg[aria-label="Home"]', { timeout: 5000 });
                log.success('✅ Login state verified after cookie save');

            } catch (error) {
                log.error('❌ Login failed:', error.message);
                await page.screenshot({ path: 'login-error.png', fullPage: true });
                throw error;
            }
        }

        // Check for expired cookies
        const cookies = await page.cookies();
        const expiredCookies = cookies.filter(cookie => cookie.expires && cookie.expires < Date.now() / 1000);
        if (expiredCookies.length > 0) {
            log.warning(`⚠️ Found ${expiredCookies.length} expired cookies! Re-logging in...`);
            fs.unlinkSync(COOKIE_PATH); // Delete expired cookies
            // Re-run login process
            await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
            await page.type('input[name="username"]', process.env.INSTAGRAM_USERNAME, { delay: 120 });
            await page.type('input[name="password"]', process.env.INSTAGRAM_PASSWORD, { delay: 120 });
            await page.click('button[type="submit"]');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            const newCookies = await page.cookies();
            fs.writeFileSync(COOKIE_PATH, JSON.stringify(newCookies));
            log.security('✅ Re-login successful! New cookies saved.');
        }

        // Save initial session state
        await saveSessionState(followCount, lastFollowedUser);

        // Random mouse movements
        async function performRandomMouseMovements() {
            const width = 1920;
            const height = 1080;
            for (let i = 0; i < 3; i++) {
                const x = Math.floor(Math.random() * width);
                const y = Math.floor(Math.random() * height);
                await page.mouse.move(x, y);
                await randomDelay(500, 1000);
            }
        }

        // Set a longer default timeout
        page.setDefaultTimeout(60000);

        // Additional verification after successful login
        try {
            log.debug('Performing post-login verification...');
            await page.waitForSelector('svg[aria-label="Home"]', { visible: true, timeout: 5000 });
            log.success('Post-login verification successful');
        } catch (error) {
            log.warning('Post-login verification failed:', error.message);
            await page.screenshot({ path: 'post-login-verification-failed.png', fullPage: true });
        }

        await randomDelay(2000, 4000);

        // Handle any popups
        try {
            const notNowButtons = await page.$$('button:has-text("Not Now")');
            for (const button of notNowButtons) {
                await button.click();
                await randomDelay(1000, 2000);
            }
            log.info('Handled potential popups');
        } catch (e) {
            log.info('No popups found');
        }

        // Get follower and following counts
        log.info('Fetching follower and following counts...');
        await page.goto(`https://www.instagram.com/${process.env.INSTAGRAM_USERNAME}/`, { waitUntil: 'networkidle0' });
        await randomDelay(2000, 3000);

        const counts = await page.evaluate(() => {
            const countsSection = document.querySelector('ul.x78zum5');
            if (!countsSection) return null;

            const countSpans = countsSection.querySelectorAll('span._ac2a, span.html-span');
            if (countSpans.length >= 3) {
                const followersText = countSpans[1].textContent;
                const followingText = countSpans[2].textContent;

                const parseCount = (text) => {
                    text = text.toLowerCase().trim();
                    if (text.includes('k')) {
                        return Math.round(parseFloat(text.replace('k', '')) * 1000);
                    } else if (text.includes('m')) {
                        return Math.round(parseFloat(text.replace('m', '')) * 1000000);
                    } else {
                        return parseInt(text.replace(/,/g, ''));
                    }
                };

                return {
                    followers: parseCount(followersText),
                    following: parseCount(followingText)
                };
            }
            return null;
        });

        if (counts) {
            log.info(`Current followers: ${counts.followers}`);
            log.info(`Current following: ${counts.following}`);
        }

        // Now check/create today's record with the counts we just got
        let todayRecord = await followersCollection.findOne({ date: today });
        if (!todayRecord) {
            // If no record exists for today, create one with initial values
            const initialDoc = {
                date: today,
                totalFollowedToday: 0,
                totalFollowers: counts ? counts.followers : 0,
                totalFollowing: counts ? counts.following : 0
            };
            await followersCollection.insertOne(initialDoc);
            log.info('Created new record for today:', initialDoc);
            todayRecord = await followersCollection.findOne({ date: today });
        }

        // Update initial counts if they exist
        if (counts) {
            await followersCollection.updateOne(
                { date: today },
                {
                    $set: {
                        totalFollowers: counts.followers,
                        totalFollowing: counts.following
                    }
                }
            );
            log.info('Updated initial follower and following counts in MongoDB');
        }

        while (followCount < MAX_FOLLOWS) {
            log.info('Navigating to suggestions page...');
            await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'networkidle0' });
            await randomDelay(2000, 4000);

            log.info('Waiting for suggested users to load...');
            // Try multiple button selectors
            const buttonSelectors = [
                'button._acan._acap._acas._aj1-',
                'button[type="button"]._acan._acap._acas',
                'button._acan._acap._acas',
                'button[type="button"]:not([disabled])'
            ];

            let followButtons = [];
            for (const selector of buttonSelectors) {
                log.debug(`Trying button selector: ${selector}`);
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    followButtons = await page.$$(selector);
                    if (followButtons.length > 0) {
                        log.debug(`Found ${followButtons.length} follow buttons using selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    log.debug(`No buttons found with selector: ${selector}`);
                }
            }

            if (followButtons.length === 0) {
                log.info('No follow buttons found, refreshing page...');
                await page.reload({ waitUntil: 'networkidle0' });
                await randomDelay(3000, 5000);
                continue;
            }

            // Filter out any non-follow buttons
            const validButtons = [];
            for (const button of followButtons) {
                const buttonText = await button.evaluate(el => el.textContent.trim().toLowerCase());
                if (buttonText === 'follow') {
                    validButtons.push(button);
                }
            }
            followButtons = validButtons;
            log.debug(`Found ${followButtons.length} valid follow buttons`);

            // If no valid buttons found, refresh and try again
            if (followButtons.length === 0) {
                log.info('No valid follow buttons found, refreshing page...');
                await page.reload({ waitUntil: 'networkidle0' });
                await randomDelay(3000, 5000);
                continue;
            }

            // Get all follow buttons and log the count
            const followButtonsCount = followButtons.length;

            // If no containers found but buttons exist, create dummy containers
            if (followButtons.length === 0 && followButtonsCount > 0) {
                log.info('No containers found but buttons exist. Creating virtual containers...');
                followButtons = followButtonsCount.map(() => null);
            }

            // Verify if counts match
            if (followButtons.length !== followButtonsCount) {
                log.warning('Warning: Number of user containers does not match number of follow buttons');
                log.warning('Will proceed using button count as reference');
            }

            // Follow users until we reach the limit or run out of buttons
            for (let i = 0; i < followButtons.length && followCount < MAX_FOLLOWS; i++) {
                try {
                    log.debug(`\nProcessing user ${i + 1}:`);

                    // First, ensure the button is in view
                    await followButtons[i].evaluate(button => {
                        button.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                    await randomDelay(1000, 2000);

                    // Get username using multiple approaches
                    const username = await page.evaluate(async (buttonIndex) => {
                        const button = document.querySelectorAll('button._acan._acap._acas._aj1-')[buttonIndex];
                        if (!button) {
                            console.log('DEBUG: Button not found');
                            return null;
                        }

                        // Log the entire parent structure for debugging
                        let parent = button.parentElement;
                        let depth = 0;
                        let parentChain = [];
                        while (parent && depth < 5) {
                            parentChain.push({
                                tag: parent.tagName,
                                classes: parent.className,
                                html: parent.outerHTML
                            });
                            parent = parent.parentElement;
                            depth++;
                        }
                        console.log('DEBUG: Parent chain:', JSON.stringify(parentChain, null, 2));

                        // Try different methods to find the username
                        const findUsername = () => {
                            // Method 1: Find closest article and get username from link
                            const article = button.closest('article') || button.closest('div[role="presentation"]');
                            if (article) {
                                console.log('DEBUG: Found article:', article.outerHTML);

                                // Try to find username in links
                                const links = article.querySelectorAll('a[role="link"]');
                                for (const link of links) {
                                    const href = link.getAttribute('href');
                                    if (href && href.startsWith('/') && !href.includes('/explore/') && !href.includes('/accounts/')) {
                                        const potentialUsername = href.split('/')[1];
                                        console.log('DEBUG: Found potential username from href:', potentialUsername);
                                        if (isValidUsername(potentialUsername)) return potentialUsername;
                                    }

                                    // Try to get username from link text
                                    const linkText = link.textContent.trim();
                                    console.log('DEBUG: Found link text:', linkText);
                                    if (isValidUsername(linkText)) return linkText;
                                }

                                // Try to find username in spans with specific classes
                                const usernameSpans = article.querySelectorAll('span._ap3a._aaco._aacw._aacx._aad7._aade');
                                for (const span of usernameSpans) {
                                    const text = span.textContent.trim();
                                    console.log('DEBUG: Found span text:', text);
                                    if (isValidUsername(text)) return text;
                                }
                            }

                            // Method 2: Look for username in parent elements
                            let current = button.parentElement;
                            while (current) {
                                const links = current.querySelectorAll('a[role="link"]');
                                for (const link of links) {
                                    if (link.textContent.includes('Follow')) continue;
                                    const text = link.textContent.trim();
                                    console.log('DEBUG: Found parent link text:', text);
                                    if (isValidUsername(text)) return text;
                                }
                                current = current.parentElement;
                            }

                            // Method 3: Try to find username in nearby elements
                            const container = button.closest('div[role="presentation"]') || button.closest('div._aano');
                            if (container) {
                                const allText = container.textContent.trim();
                                console.log('DEBUG: Container text:', allText);
                                const words = allText.split(/[\s\n]+/);
                                for (const word of words) {
                                    if (isValidUsername(word)) return word;
                                }
                            }

                            return null;
                        };

                        // Username validation helper
                        function isValidUsername(text) {
                            if (!text) return false;
                            if (text.length === 0 || text.length >= 31) return false;
                            if (text.includes(' ')) return false;
                            if (/[^\w.]/.test(text)) return false;
                            if (text.includes('Follow') ||
                                text.includes('Following') ||
                                text.includes('Suggested') ||
                                text.includes('Meta') ||
                                text.includes('Instagram')) return false;
                            console.log('DEBUG: Valid username found:', text);
                            return true;
                        }

                        return findUsername();
                    }, i);

                    if (!username) {
                        log.debug('Could not find valid username, skipping...');
                        continue;
                    }

                    log.debug(`Found username: ${username}`);

                    // Verify the button is still "Follow"
                    const buttonText = await followButtons[i].evaluate(button => button.textContent.trim());
                    log.debug(`Button text: "${buttonText}"`);

                    if (buttonText === 'Follow') {
                        log.info(`Attempting to follow user: ${username}`);

                        try {
                            // First verify button is actually clickable
                            const isClickable = await page.evaluate((btn) => {
                                const style = window.getComputedStyle(btn);
                                const rect = btn.getBoundingClientRect();
                                return style.display !== 'none' &&
                                    style.visibility !== 'hidden' &&
                                    style.opacity !== '0' &&
                                    rect.width > 0 &&
                                    rect.height > 0;
                            }, followButtons[i]);

                            if (!isClickable) {
                                log.info('Button is not clickable, attempting to fix...');
                                await page.evaluate((btn) => {
                                    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    btn.style.opacity = '1';
                                    btn.style.visibility = 'visible';
                                    btn.style.display = 'block';
                                }, followButtons[i]);
                                await randomDelay(1000, 2000);
                            }

                            // Try multiple click methods with verification
                            let followSuccess = false;
                            const clickMethods = [
                                // Method 1: Direct Puppeteer click
                                async () => {
                                    await followButtons[i].click({ delay: 100 });
                                    await randomDelay(1000, 2000);
                                },
                                // Method 2: Mouse move and click
                                async () => {
                                    const box = await followButtons[i].boundingBox();
                                    if (box) {
                                        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                                        await randomDelay(200, 500);
                                        await page.mouse.down();
                                        await randomDelay(50, 150);
                                        await page.mouse.up();
                                    }
                                    await randomDelay(1000, 2000);
                                },
                                // Method 3: JavaScript click
                                async () => {
                                    await page.evaluate((btn) => {
                                        btn.click();
                                        // Dispatch click event as backup
                                        const clickEvent = new MouseEvent('click', {
                                            view: window,
                                            bubbles: true,
                                            cancelable: true
                                        });
                                        btn.dispatchEvent(clickEvent);
                                    }, followButtons[i]);
                                    await randomDelay(1000, 2000);
                                }
                            ];

                            // Try each click method until one works
                            for (const clickMethod of clickMethods) {
                                if (followSuccess) break;

                                try {
                                    await clickMethod();

                                    // Verify the follow was successful
                                    const buttonState = await page.evaluate(btn => {
                                        return {
                                            text: btn.textContent.trim(),
                                            classes: btn.className,
                                            disabled: btn.disabled,
                                            visible: btn.offsetParent !== null
                                        };
                                    }, followButtons[i]);

                                    log.debug('Button state after click:', buttonState);

                                    if (buttonState.text === 'Following' ||
                                        buttonState.text.includes('Following') ||
                                        buttonState.disabled) {
                                        followSuccess = true;
                                        log.info('Follow successful using click method');
                                        break;
                                    }
                                } catch (e) {
                                    log.debug('Click method failed, trying next method...');
                                }
                            }

                            if (followSuccess) {
                                log.info('Successfully followed user');
                                followCount++;

                                // Update MongoDB with atomic operations
                                try {
                                    // First, get the current state
                                    const currentState = await followersCollection.findOne({ date: today });
                                    log.debug('Current state before update:', currentState);

                                    // Perform the update without storing usernames
                                    const updateResult = await followersCollection.updateOne(
                                        { date: today },
                                        {
                                            $inc: {
                                                totalFollowedToday: 1,
                                                totalFollowing: 1
                                            }
                                        }
                                    );

                                    if (updateResult.modifiedCount === 0) {
                                        log.warning('Warning: MongoDB document was not updated!');
                                        log.debug('Update result:', updateResult);
                                    } else {
                                        log.info('MongoDB update successful');
                                    }

                                    // Verify the update
                                    const updatedDoc = await followersCollection.findOne({ date: today });
                                    log.debug('State after update:', {
                                        before: {
                                            totalFollowedToday: currentState.totalFollowedToday,
                                            totalFollowing: currentState.totalFollowing
                                        },
                                        after: {
                                            totalFollowedToday: updatedDoc.totalFollowedToday,
                                            totalFollowing: updatedDoc.totalFollowing
                                        }
                                    });

                                    // Double-check if the update was successful
                                    if (updatedDoc.totalFollowedToday === currentState.totalFollowedToday) {
                                        log.warning('Warning: totalFollowedToday did not increase!');
                                        // Force update if necessary
                                        await followersCollection.updateOne(
                                            { date: today },
                                            {
                                                $set: {
                                                    totalFollowedToday: (currentState.totalFollowedToday || 0) + 1,
                                                    totalFollowing: (currentState.totalFollowing || 0) + 1
                                                }
                                            }
                                        );
                                    }
                                } catch (dbError) {
                                    log.error('Error updating MongoDB:', dbError);
                                    log.error('Error details:', {
                                        name: dbError.name,
                                        message: dbError.message,
                                        code: dbError.code
                                    });
                                }

                                // Random delay between 10-15 seconds before next follow
                                const delay = Math.floor(Math.random() * (MAX_FOLLOW_DELAY - MIN_FOLLOW_DELAY + 1)) + MIN_FOLLOW_DELAY;
                                log.debug(`Waiting ${Math.round(delay / 1000)} seconds before next follow...`);
                                await randomDelay(delay, delay);
                            } else {
                                log.info(`Follow may have failed. Button text is now: "${buttonText}"`);
                                // Add a shorter delay even if follow failed (5-8 seconds)
                                await randomDelay(5000, 8000);
                            }
                        } catch (clickError) {
                            log.error('Error while trying to follow:', clickError.message);
                            await randomDelay(3000, 5000);
                        }
                    } else {
                        log.info(`Skipping user ${username} - button shows "${buttonText}"`);
                    }
                } catch (error) {
                    log.error('Error processing user:', error.message);
                    continue;
                }
            }

            // If we haven't reached our target, refresh and try again
            if (followCount < MAX_FOLLOWS) {
                log.info(`\nRefreshing page to get more suggestions (followed ${followCount} so far)...`);
                await page.reload({ waitUntil: 'networkidle0' });
                await randomDelay(3000, 5000);

                // Wait for new content to load
                try {
                    await page.waitForSelector('button._acan._acap._acas._aj1-', { timeout: 10000 });
                    const newButtonCount = await page.$$eval('button._acan._acap._acas._aj1-', buttons => buttons.length);
                    log.debug(`Found ${newButtonCount} new buttons after refresh`);
                } catch (error) {
                    log.error('Error loading new suggestions:', error.message);
                }
            }
        }

        log.info(`Successfully completed following ${followCount} users!`);

        // Get final stats from database
        const finalStats = await followersCollection.findOne({ date: today });
        log.info('Today\'s following statistics:');
        log.info(`Total followed today: ${finalStats.totalFollowedToday}`);
        log.info(`Total followers: ${finalStats.totalFollowers}`);
        log.info(`Total following: ${finalStats.totalFollowing}`);

        await browser.close();
        log.info('🌐 Browser closed. Script finished.');
    } catch (error) {
        log.error('❌ An error occurred:', error.message);
        log.error('Stack trace:', error.stack);
        log.info(`📊 Managed to follow ${followCount} people before the error occurred.`);

        // Take a screenshot if there's an error
        if (page) {
            try {
                await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
                log.info('📸 Error screenshot saved as error-screenshot.png');
            } catch (screenshotError) {
                log.error('Failed to take error screenshot:', screenshotError.message);
            }
        }

        if (browser) {
            try {
                await browser.close();
                log.info('🌐 Browser closed after error.');
            } catch (e) {
                log.error('Failed to close browser:', e.message);
            }
        }
        process.exit(1);
    } finally {
        // Save final session state
        await saveSessionState(followCount, lastFollowedUser);

        // Calculate session duration
        const sessionEndTime = new Date();
        const sessionDuration = (sessionEndTime - sessionStartTime) / 1000 / 60; // in minutes

        log.info(`⏱️ Session ended at: ${sessionEndTime.toISOString()}`);
        log.info(`⏱️ Total session duration: ${Math.round(sessionDuration)} minutes`);
        log.info(`📊 Total follows in this session: ${followCount}`);
        log.info(`📈 Average follows per minute: ${(followCount / sessionDuration).toFixed(2)}`);

        await client.close(); // Ensure MongoDB connection is closed
        log.info('📦 MongoDB connection closed');
    }
})();