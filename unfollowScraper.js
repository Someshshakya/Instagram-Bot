const puppeteer = require('puppeteer');
require('dotenv').config();

const MAX_UNFOLLOWS = 100; // Maximum number of people to unfollow
const MIN_UNFOLLOW_DELAY = 10000; // Minimum delay between unfollows (10 seconds)
const MAX_UNFOLLOW_DELAY = 20000; // Maximum delay between unfollows (20 seconds)

// Random delay function to make actions more human-like
const randomDelay = async (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
};

(async () => {
    let browser;
    let page;
    let unfollowCount = 0;

    try {
        console.log('Starting Instagram automation...');
        console.log(`Will unfollow maximum ${MAX_UNFOLLOWS} people...`);

        console.log('Launching browser...');
        browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--disable-notifications',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });

        page = await browser.newPage();

        // Set user agent to look more like a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

        // Set a longer default timeout
        page.setDefaultTimeout(60000);

        console.log('Navigating to Instagram login page...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle0' });
        await randomDelay(2000, 4000);

        console.log('Attempting to login...');
        await page.waitForSelector('input[name="username"]', { visible: true });
        await randomDelay(1000, 2000);

        // Type like a human with variable delays
        for (const char of process.env.INSTAGRAM_USERNAME) {
            await page.type('input[name="username"]', char);
            await randomDelay(50, 150);
        }

        await randomDelay(500, 1000);

        for (const char of process.env.INSTAGRAM_PASSWORD) {
            await page.type('input[name="password"]', char);
            await randomDelay(50, 150);
        }

        await randomDelay(500, 1000);
        await page.click('button[type="submit"]');

        console.log('Waiting for login to complete...');
        // Wait for either the home feed or the security checkpoint
        await Promise.race([
            page.waitForSelector('svg[aria-label="Home"]', { visible: true, timeout: 30000 }),
            page.waitForSelector('input[name="verificationCode"]', { visible: true, timeout: 30000 })
        ]);

        // Check if we hit a security checkpoint
        const securityCheck = await page.$('input[name="verificationCode"]');
        if (securityCheck) {
            console.log('Security checkpoint detected! Please check your email/phone for verification code.');
            await browser.close();
            return;
        }

        console.log('Successfully logged in!');
        await randomDelay(2000, 4000);

        // Handle any popups
        try {
            const notNowButtons = await page.$$('button:has-text("Not Now")');
            for (const button of notNowButtons) {
                await button.click();
                await randomDelay(1000, 2000);
            }
            console.log('Handled potential popups');
        } catch (e) {
            console.log('No popups found');
        }

        // Navigate to profile page
        console.log('Navigating to profile page...');
        await page.goto(`https://www.instagram.com/${process.env.INSTAGRAM_USERNAME}/`, { waitUntil: 'networkidle0' });
        await randomDelay(3000, 5000);

        // Click on following count
        console.log('Opening following list...');

        // Wait for the following count to be visible and click it
        await page.waitForXPath("//a[contains(@href, '/following')]");
        const [followingLink] = await page.$x("//a[contains(@href, '/following')]");
        if (followingLink) {
            await followingLink.click();
        } else {
            throw new Error("Could not find following link");
        }
        await randomDelay(3000, 5000);

        while (unfollowCount < MAX_UNFOLLOWS) {
            // Wait for the modal to load
            console.log('Waiting for following list to load...');

            // Wait for any button that contains "Following" text
            await page.waitForXPath("//button[contains(., 'Following')]", { timeout: 10000 });
            const unfollowButtons = await page.$x("//button[contains(., 'Following')]");

            console.log(`Found ${unfollowButtons.length} unfollow buttons`);

            if (unfollowButtons.length === 0) {
                console.log('No more users to unfollow');
                break;
            }

            // Unfollow users
            for (let i = 0; i < unfollowButtons.length && unfollowCount < MAX_UNFOLLOWS; i++) {
                try {
                    console.log(`Unfollowing user ${unfollowCount + 1} of ${MAX_UNFOLLOWS}...`);
                    await unfollowButtons[i].click();
                    await randomDelay(1000, 2000);

                    // Click "Unfollow" on the confirmation dialog if it appears
                    try {
                        const [confirmButton] = await page.$x("//button[contains(., 'Unfollow')]");
                        if (confirmButton) {
                            await confirmButton.click();
                        }
                    } catch (e) {
                        // No confirmation dialog appeared, continue
                    }

                    unfollowCount++;

                    const delay = Math.floor(Math.random() * (MAX_UNFOLLOW_DELAY - MIN_UNFOLLOW_DELAY + 1)) + MIN_UNFOLLOW_DELAY;
                    console.log(`Unfollowed ${unfollowCount} people so far. Waiting ${Math.round(delay / 1000)} seconds before next unfollow...`);
                    await randomDelay(delay, delay);
                } catch (error) {
                    console.log(`Failed to unfollow user: ${error.message}`);
                    continue;
                }
            }

            // Scroll the following list to load more
            await page.evaluate(() => {
                const dialog = document.querySelector('div[role="dialog"]');
                if (dialog) dialog.scrollTop = dialog.scrollHeight;
            });
            await randomDelay(2000, 4000);
        }

        console.log(`Successfully completed unfollowing ${unfollowCount} users!`);
        await browser.close();
        console.log('Browser closed. Script finished.');
    } catch (error) {
        console.error('An error occurred:', error.message);
        console.error('Stack trace:', error.stack);
        console.log(`Managed to unfollow ${unfollowCount} people before the error occurred.`);

        // Take a screenshot if there's an error
        if (page) {
            try {
                await page.screenshot({ path: 'error-screenshot.png', fullPage: true });
                console.log('Error screenshot saved as error-screenshot.png');
            } catch (screenshotError) {
                console.error('Failed to take error screenshot:', screenshotError.message);
            }
        }

        if (browser) {
            try {
                await browser.close();
                console.log('Browser closed after error.');
            } catch (e) {
                console.error('Failed to close browser:', e.message);
            }
        }
        process.exit(1);
    }
})(); 