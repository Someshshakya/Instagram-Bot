const { MongoClient } = require('mongodb');
const puppeteer = require('puppeteer');
require('dotenv').config();

async function testConnections() {
    let browser;
    let mongoClient;

    try {
        // Test MongoDB Connection
        console.log('Testing MongoDB connection...');
        mongoClient = new MongoClient(process.env.MONGODB_URI);
        await mongoClient.connect();
        console.log('✅ MongoDB Connection successful!');

        // Test database access
        const db = mongoClient.db('instagram_bot');
        await db.command({ ping: 1 });
        console.log('✅ Database access verified!');

        // Test Instagram Login
        console.log('\nTesting Instagram credentials...');
        browser = await puppeteer.launch({
            headless: false, // Changed to false for debugging
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        await page.setDefaultTimeout(60000); // Increased timeout

        // Set user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        // Navigate to Instagram
        console.log('Navigating to Instagram...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle0' });
        console.log('✅ Successfully loaded Instagram login page');

        // Add delay before login
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Wait for and fill in the login form
        console.log('Filling login form...');
        await page.waitForSelector('input[name="username"]', { visible: true });

        // Type like a human
        for (const char of process.env.INSTAGRAM_USERNAME) {
            await page.type('input[name="username"]', char);
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        for (const char of process.env.INSTAGRAM_PASSWORD) {
            await page.type('input[name="password"]', char);
            await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
        }

        console.log('Clicking login button...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await page.click('button[type="submit"]');

        // Wait for various possible outcomes
        console.log('Waiting for login response...');
        try {
            await Promise.race([
                page.waitForSelector('svg[aria-label="Home"]', { visible: true, timeout: 30000 }),
                page.waitForSelector('input[name="verificationCode"]', { visible: true, timeout: 30000 }),
                page.waitForSelector('p[data-testid="login-error-message"]', { visible: true, timeout: 30000 }),
                page.waitForSelector('div[role="dialog"]', { visible: true, timeout: 30000 })
            ]);

            // Check for error message
            const errorMessage = await page.$('p[data-testid="login-error-message"]');
            if (errorMessage) {
                const error = await page.evaluate(el => el.textContent, errorMessage);
                throw new Error(`Instagram login failed: ${error}`);
            }

            // Check for verification code request
            const verificationCode = await page.$('input[name="verificationCode"]');
            if (verificationCode) {
                console.log('⚠️ Instagram requires verification code. Please check your email/phone.');
                // Keep browser open for manual verification
                return;
            }

            // Check for suspicious login attempt dialog
            const suspiciousLogin = await page.$('div[role="dialog"]');
            if (suspiciousLogin) {
                const dialogText = await page.evaluate(el => el.textContent, suspiciousLogin);
                if (dialogText.includes('suspicious') || dialogText.includes('unusual')) {
                    console.log('⚠️ Instagram detected suspicious login attempt.');
                    // Take screenshot for debugging
                    await page.screenshot({ path: 'suspicious-login.png', fullPage: true });
                    return;
                }
            }

            // Check if we're actually logged in
            const homeIcon = await page.$('svg[aria-label="Home"]');
            if (homeIcon) {
                console.log('✅ Instagram login successful!');

                // Get to the profile page to verify full access
                await page.goto(`https://www.instagram.com/${process.env.INSTAGRAM_USERNAME}/`);
                console.log('✅ Successfully accessed profile page');
            } else {
                console.log('⚠️ Login status unclear - no home icon found');
                await page.screenshot({ path: 'login-status-unclear.png', fullPage: true });
            }

        } catch (error) {
            console.error('❌ Login process error:', error.message);
            await page.screenshot({ path: 'login-error.png', fullPage: true });
        }

    } catch (error) {
        console.error('❌ Error during testing:', error.message);
        if (page) {
            await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
        }
    } finally {
        // Don't close the browser if we need verification
        const verificationNeeded = await page?.$('input[name="verificationCode"]');
        if (!verificationNeeded) {
            if (browser) {
                await browser.close();
                console.log('Browser closed');
            }
        } else {
            console.log('Browser kept open for verification. Please complete the verification process.');
        }

        if (mongoClient) {
            await mongoClient.close();
            console.log('\nMongoDB connection closed');
        }
    }
}

// Run the tests
console.log('Starting connection tests...\n');
testConnections().then(() => {
    console.log('\nTests completed!');
}); 