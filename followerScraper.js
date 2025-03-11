const puppeteer = require('puppeteer');
require('dotenv').config();
const { MongoClient } = require('mongodb');
const uri = 'mongodb://127.0.0.1:27017/instagram_bot';
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
    await new Promise(resolve => setTimeout(resolve, delay));
};

(async () => {
    let browser;
    let page;
    let followCount = 0;

    try {
        console.log('Starting Instagram automation...');
        console.log(`Will follow maximum ${MAX_FOLLOWS} people...`);

        // Connect to MongoDB
        await client.connect();
        const database = client.db('instagram_bot');
        const followersCollection = database.collection('followers');

        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];

        // Launch browser and get initial counts first
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

        // Get follower and following counts
        console.log('Fetching follower and following counts...');
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
            console.log(`Current followers: ${counts.followers}`);
            console.log(`Current following: ${counts.following}`);
        }

        // Now check/create today's record with the counts we just got
        let todayRecord = await followersCollection.findOne({ date: today });
        if (!todayRecord) {
            // If no record exists for today, create one with initial values
            const initialDoc = {
                date: today,
                totalFollowedToday: 0,
                following: [],
                totalFollowers: counts ? counts.followers : 0,
                totalFollowing: counts ? counts.following : 0
            };
            await followersCollection.insertOne(initialDoc);
            console.log('Created new record for today:', initialDoc);
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
            console.log('Updated initial follower and following counts in MongoDB');
        }

        while (followCount < MAX_FOLLOWS) {
            console.log('Navigating to suggestions page...');
            await page.goto('https://www.instagram.com/explore/people/', { waitUntil: 'networkidle0' });
            await randomDelay(2000, 4000);

            console.log('Waiting for suggested users to load...');
            // Try multiple button selectors
            const buttonSelectors = [
                'button._acan._acap._acas._aj1-',
                'button[type="button"]._acan._acap._acas',
                'button._acan._acap._acas',
                'button[type="button"]:not([disabled])'
            ];

            let followButtons = [];
            for (const selector of buttonSelectors) {
                console.log(`Trying button selector: ${selector}`);
                try {
                    await page.waitForSelector(selector, { timeout: 5000 });
                    followButtons = await page.$$(selector);
                    if (followButtons.length > 0) {
                        console.log(`Found ${followButtons.length} follow buttons using selector: ${selector}`);
                        break;
                    }
                } catch (e) {
                    console.log(`No buttons found with selector: ${selector}`);
                }
            }

            if (followButtons.length === 0) {
                console.log('No follow buttons found, refreshing page...');
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
            console.log(`Found ${followButtons.length} valid follow buttons`);

            // If no valid buttons found, refresh and try again
            if (followButtons.length === 0) {
                console.log('No valid follow buttons found, refreshing page...');
                await page.reload({ waitUntil: 'networkidle0' });
                await randomDelay(3000, 5000);
                continue;
            }

            // Get all follow buttons and log the count
            const followButtonsCount = followButtons.length;

            // If no containers found but buttons exist, create dummy containers
            if (followButtons.length === 0 && followButtonsCount > 0) {
                console.log('No containers found but buttons exist. Creating virtual containers...');
                followButtons = followButtonsCount.map(() => null);
            }

            // Verify if counts match
            if (followButtons.length !== followButtonsCount) {
                console.log('Warning: Number of user containers does not match number of follow buttons');
                console.log('Will proceed using button count as reference');
            }

            // Follow users until we reach the limit or run out of buttons
            for (let i = 0; i < followButtons.length && followCount < MAX_FOLLOWS; i++) {
                try {
                    console.log(`\nProcessing user ${i + 1}:`);

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
                        console.log('Could not find valid username, skipping...');
                        continue;
                    }

                    console.log(`Found username: ${username}`);

                    // Verify the button is still "Follow"
                    const buttonText = await followButtons[i].evaluate(button => button.textContent.trim());
                    console.log(`Button text: "${buttonText}"`);

                    if (buttonText === 'Follow') {
                        console.log(`Attempting to follow user: ${username}`);

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
                                console.log('Button is not clickable, attempting to fix...');
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

                                    console.log('Button state after click:', buttonState);

                                    if (buttonState.text === 'Following' ||
                                        buttonState.text.includes('Following') ||
                                        buttonState.disabled) {
                                        followSuccess = true;
                                        console.log('Follow successful using click method');
                                        break;
                                    }
                                } catch (e) {
                                    console.log('Click method failed, trying next method...');
                                }
                            }

                            if (followSuccess) {
                                console.log('Successfully followed user');
                                followCount++;

                                // Update MongoDB with atomic operations
                                try {
                                    // First, get the current state
                                    const currentState = await followersCollection.findOne({ date: today });
                                    console.log('Current state before update:', currentState);

                                    // Perform the update
                                    const updateResult = await followersCollection.updateOne(
                                        { date: today },
                                        {
                                            $inc: {
                                                totalFollowedToday: 1
                                            },
                                            $addToSet: {
                                                following: username
                                            },
                                            $set: {
                                                totalFollowing: (currentState.totalFollowing || 0) + 1
                                            }
                                        }
                                    );

                                    if (updateResult.modifiedCount === 0) {
                                        console.error('Warning: MongoDB document was not updated!');
                                        console.log('Update result:', updateResult);
                                    } else {
                                        console.log('MongoDB update successful');
                                    }

                                    // Verify the update
                                    const updatedDoc = await followersCollection.findOne({ date: today });
                                    console.log('State after update:', {
                                        before: {
                                            totalFollowedToday: currentState.totalFollowedToday,
                                            followingCount: currentState.following.length,
                                            totalFollowing: currentState.totalFollowing
                                        },
                                        after: {
                                            totalFollowedToday: updatedDoc.totalFollowedToday,
                                            followingCount: updatedDoc.following.length,
                                            totalFollowing: updatedDoc.totalFollowing
                                        }
                                    });

                                    // Double-check if the update was successful
                                    if (updatedDoc.totalFollowedToday === currentState.totalFollowedToday) {
                                        console.error('Warning: totalFollowedToday did not increase!');
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
                                    console.error('Error updating MongoDB:', dbError);
                                    console.error('Error details:', {
                                        name: dbError.name,
                                        message: dbError.message,
                                        code: dbError.code
                                    });
                                }

                                // Random delay between 10-15 seconds before next follow
                                const delay = Math.floor(Math.random() * (MAX_FOLLOW_DELAY - MIN_FOLLOW_DELAY + 1)) + MIN_FOLLOW_DELAY;
                                console.log(`Waiting ${Math.round(delay / 1000)} seconds before next follow...`);
                                await randomDelay(delay, delay);
                            } else {
                                console.log(`Follow may have failed. Button text is now: "${buttonText}"`);
                                // Add a shorter delay even if follow failed (5-8 seconds)
                                await randomDelay(5000, 8000);
                            }
                        } catch (clickError) {
                            console.log('Error while trying to follow:', clickError.message);
                            await randomDelay(3000, 5000);
                        }
                    } else {
                        console.log(`Skipping user ${username} - button shows "${buttonText}"`);
                    }
                } catch (error) {
                    console.log('Error processing user:', error.message);
                    continue;
                }
            }

            // If we haven't reached our target, refresh and try again
            if (followCount < MAX_FOLLOWS) {
                console.log(`\nRefreshing page to get more suggestions (followed ${followCount} so far)...`);
                await page.reload({ waitUntil: 'networkidle0' });
                await randomDelay(3000, 5000);

                // Wait for new content to load
                try {
                    await page.waitForSelector('button._acan._acap._acas._aj1-', { timeout: 10000 });
                    const newButtonCount = await page.$$eval('button._acan._acap._acas._aj1-', buttons => buttons.length);
                    console.log(`Found ${newButtonCount} new buttons after refresh`);
                } catch (error) {
                    console.log('Error loading new suggestions:', error.message);
                }
            }
        }

        console.log(`Successfully completed following ${followCount} users!`);

        // Get final stats from database
        const finalStats = await followersCollection.findOne({ date: today });
        console.log('Today\'s following statistics:');
        console.log(`Total followed today: ${finalStats.totalFollowedToday}`);
        console.log(`Total unique users followed: ${finalStats.following.length}`);
        console.log(`Total followers: ${finalStats.totalFollowers}`);
        console.log(`Total following: ${finalStats.totalFollowing}`);

        await browser.close();
        console.log('Browser closed. Script finished.');
    } catch (error) {
        console.error('An error occurred:', error.message);
        console.error('Stack trace:', error.stack);
        console.log(`Managed to follow ${followCount} people before the error occurred.`);

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
    } finally {
        await client.close(); // Ensure MongoDB connection is closed
    }
})();