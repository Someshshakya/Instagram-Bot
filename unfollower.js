const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

class InstagramUnfollower {
    constructor() {
        dotenv.config();
        this.username = process.env.INSTAGRAM_USERNAME;
        this.password = process.env.INSTAGRAM_PASSWORD;
        this.maxUnfollows = 100;
        this.delayBetweenUnfollows = 5000; // 5 seconds between unfollows
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async login() {
        try {
            this.browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: ['--start-maximized']
            });

            this.page = await this.browser.newPage();
            await this.page.setViewport({ width: 1280, height: 800 });

            console.log('Going to Instagram...');
            await this.page.goto('https://www.instagram.com/');
            await this.delay(5000);

            console.log('Waiting for login form...');
            await this.page.waitForSelector('input[name="username"]', { visible: true, timeout: 60000 });
            await this.page.waitForSelector('input[name="password"]', { visible: true, timeout: 60000 });

            console.log('Logging in...');
            await this.page.type('input[name="username"]', this.username, { delay: 100 });
            await this.delay(1000);
            await this.page.type('input[name="password"]', this.password, { delay: 100 });
            await this.delay(1000);

            // Find and click the login button
            const loginButton = await this.page.waitForSelector('button[type="submit"]');
            await loginButton.click();

            // Wait for login to complete
            await this.delay(5000);

            // Handle any "Save Login Info" popup
            try {
                const notNowButton = await this.page.waitForSelector('button:has-text("Not Now")', { timeout: 5000 });
                if (notNowButton) {
                    await notNowButton.click();
                }
            } catch (e) { }

            await this.delay(2000);

            // Handle notifications popup
            try {
                const notNowButton = await this.page.waitForSelector('button:has-text("Not Now")', { timeout: 5000 });
                if (notNowButton) {
                    await notNowButton.click();
                }
            } catch (e) { }

            console.log('Successfully logged in!');
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async unfollowUsers() {
        try {
            if (!this.page) {
                await this.login();
            }

            // Go to profile
            console.log('Going to your profile...');
            await this.page.goto(`https://www.instagram.com/${this.username}/`, {
                waitUntil: 'networkidle0',
                timeout: 60000
            });
            await this.delay(5000);

            // Click following button
            console.log('Opening following list...');
            const followingCount = await this.page.$('a[href*="/following"] span');
            if (followingCount) {
                await followingCount.click();
                console.log('Clicked following count');
            } else {
                throw new Error('Could not find following count button');
            }
            await this.delay(3000);

            // Wait for modal to appear
            console.log('Waiting for following modal...');
            await this.page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
            await this.delay(2000);

            let unfollowCount = 0;
            const unfollowedUsers = [];

            while (unfollowCount < this.maxUnfollows) {
                try {
                    // Find all following buttons in the list
                    const buttons = await this.page.$$('button');
                    let foundFollowing = false;

                    for (const button of buttons) {
                        const text = await this.page.evaluate(el => el.textContent, button);
                        if (text === 'Following') {
                            foundFollowing = true;
                            // Get username before unfollowing
                            const username = await this.page.evaluate(el => {
                                const row = el.closest('div[role="presentation"]');
                                if (!row) return 'Unknown';
                                const usernameEl = row.querySelector('span._aacl._aaco._aacw._aacx._aad7') ||
                                    row.querySelector('a[role="link"]') ||
                                    row.querySelector('span[style*="line-height"]');
                                return usernameEl ? usernameEl.textContent : 'Unknown';
                            }, button);

                            console.log(`Found Following button for ${username}`);

                            // Click the Following button
                            await button.click();
                            await this.delay(2000);

                            // Click Unfollow in the confirmation dialog
                            const confirmButton = await this.page.evaluate(() => {
                                const buttons = document.querySelectorAll('button');
                                for (const btn of buttons) {
                                    if (btn.textContent === 'Unfollow') {
                                        btn.click();
                                        return true;
                                    }
                                }
                                return false;
                            });

                            if (confirmButton) {
                                unfollowCount++;
                                unfollowedUsers.push(username);
                                console.log(`Unfollowed ${unfollowCount}: ${username}`);
                                await this.delay(this.delayBetweenUnfollows);
                            } else {
                                console.log('Could not find Unfollow confirmation button');
                            }
                            break;
                        }
                    }

                    if (!foundFollowing) {
                        console.log('No more Following buttons found, scrolling...');
                        // Scroll the dialog to load more users
                        await this.page.evaluate(() => {
                            const dialog = document.querySelector('div[role="dialog"] div');
                            if (dialog) {
                                dialog.scrollTop = dialog.scrollHeight;
                            }
                        });
                        await this.delay(2000);
                    }

                } catch (error) {
                    console.error('Error during unfollow:', error);
                    await this.delay(2000);
                }
            }

            console.log('\nUnfollow Summary:');
            console.log(`Total users unfollowed: ${unfollowCount}`);
            console.log('Unfollowed users:', unfollowedUsers);

        } catch (error) {
            console.error('Error in main process:', error);
        } finally {
            if (this.browser) {
                await this.browser.close();
            }
        }
    }
}

// Run the script
async function main() {
    const unfollower = new InstagramUnfollower();
    try {
        await unfollower.unfollowUsers();
        console.log('Finished unfollowing process');
    } catch (error) {
        console.error('Script failed:', error);
    }
}

main(); 