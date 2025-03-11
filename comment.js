const puppeteer = require('puppeteer');
require('dotenv').config();

const comments = [
    "Awesome post! 🔥",
    "Love this! ❤️",
    "Great content! Keep it up!",
    "Amazing shot! 📸",
    "This is so cool! 🙌"
];

// Random delay function to make actions more human-like
const randomDelay = async (min, max) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
};

(async () => {
    let browser;
    let page;

    console.log('Starting Instagram automation...');
    try {
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

        // Wait for the feed to load
        console.log('Waiting for feed to load...');
        await page.waitForSelector('article', { visible: true });
        await randomDelay(2000, 4000);

        // Scroll down a bit to load more posts
        console.log('Scrolling to load more posts...');
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => {
                window.scrollBy(0, 500);
            });
            await randomDelay(1000, 2000);
        }

        // Get all posts from the feed
        const posts = await page.$$('article');
        console.log(`Found ${posts.length} posts in feed`);

        if (posts.length === 0) {
            throw new Error('No posts found in feed.');
        }

        let commentCount = 0;
        for (const post of posts) {
            if (commentCount >= 10) break; // Limit to 10 comments

            try {
                console.log(`\nProcessing post ${commentCount + 1}/10`);

                // Scroll post into view
                await post.evaluate(element => {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                await randomDelay(1000, 2000);

                // Try multiple selectors for the comment button
                let commentButton = null;
                const possibleSelectors = [
                    'svg[aria-label="Comment"]',
                    '[aria-label="Comment"]',
                    'span[class*="comment"]',
                    'button[class*="comment"]'
                ];

                for (const selector of possibleSelectors) {
                    commentButton = await post.$(selector);
                    if (commentButton) {
                        console.log(`Found comment button with selector: ${selector}`);
                        break;
                    }
                }

                if (!commentButton) {
                    console.log('Comment button not found on this post, skipping...');
                    continue;
                }

                // Click the comment button
                await commentButton.click();
                await randomDelay(1000, 2000);

                // Try multiple selectors for the comment textarea
                let textarea = null;
                const textareaSelectors = [
                    'textarea[aria-label="Add a comment…"]',
                    'textarea[placeholder="Add a comment…"]',
                    'textarea'
                ];

                // First try to find the textarea within the post
                for (const selector of textareaSelectors) {
                    textarea = await post.$(selector);
                    if (textarea) {
                        console.log(`Found textarea with selector: ${selector} in post`);
                        break;
                    }
                }

                // If not found in post, try the whole page
                if (!textarea) {
                    console.log('Textarea not found in post, searching in whole page...');
                    for (const selector of textareaSelectors) {
                        textarea = await page.$(selector);
                        if (textarea) {
                            console.log(`Found textarea with selector: ${selector} in page`);
                            break;
                        }
                    }
                }

                if (!textarea) {
                    console.log('Comment textarea not found, skipping...');
                    continue;
                }

                // Click the textarea to focus it
                await textarea.click();
                await randomDelay(500, 1000);

                const randomComment = comments[Math.floor(Math.random() * comments.length)];
                console.log(`Posting comment: "${randomComment}"`);

                // Type the comment like a human
                for (const char of randomComment) {
                    await textarea.type(char);
                    await randomDelay(50, 150);
                }

                await randomDelay(500, 1000);

                // Try to find the post button
                const postButtonSelectors = [
                    'button[type="submit"]',
                    'button._acan._acap._acas._aj1-',  // Common Instagram button class
                    'button[class*="submit"]',
                    'button._acap',  // Instagram's post button class
                ];

                let postButton = null;

                // First try within the current form/container
                const form = await textarea.evaluateHandle(el => el.closest('form'));
                if (form) {
                    for (const selector of postButtonSelectors) {
                        postButton = await form.$(selector);
                        if (postButton) {
                            console.log(`Found post button with selector: ${selector} in form`);
                            break;
                        }
                    }
                }

                // If not found in form, try the whole page
                if (!postButton) {
                    console.log('Post button not found in form, searching in whole page...');
                    for (const selector of postButtonSelectors) {
                        postButton = await page.$(selector);
                        if (postButton) {
                            console.log(`Found post button with selector: ${selector} in page`);
                            break;
                        }
                    }
                }

                if (!postButton) {
                    console.log('Post button not found, trying to submit form...');
                    // Try to submit the form directly if we can't find the button
                    await page.keyboard.press('Enter');
                } else {
                    await postButton.click();
                }

                console.log(`Successfully commented on post ${commentCount + 1}`);
                commentCount++;

                // Random delay between 30-90 seconds
                const delay = Math.floor(Math.random() * (90000 - 30000 + 1)) + 30000;
                console.log(`Waiting for ${Math.round(delay / 1000)} seconds before next action...`);
                await page.waitForTimeout(delay);
            } catch (error) {
                console.log(`Error processing post: ${error.message}`);
                continue;
            }
        }

        console.log(`\nFinished commenting session. Posted ${commentCount} comments.`);
        await browser.close();
        console.log('Browser closed.');
    } catch (error) {
        console.error('An error occurred:', error.message);
        console.error('Stack trace:', error.stack);

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
            await browser.close();
        }
        process.exit(1);
    }
})();
