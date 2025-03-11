const puppeteer = require('puppeteer');
const dotenv = require('dotenv');

class InstagramFollower {
    constructor() {
        dotenv.config();
        this.username = 'someshshakyaa';
        this.password = '';
    }

    async login() {
        try {
            this.browser = await puppeteer.launch({ headless: false });
            this.page = await this.browser.newPage();

            await this.page.goto('https://www.instagram.com/accounts/login/');
            await this.page.waitForSelector('input[name="username"]');

            await this.page.type('input[name="username"]', this.username);
            await this.page.type('input[name="password"]', this.password);

            await this.page.click('button[type="submit"]');
            await this.page.waitForNavigation();
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async followUsers(usernames) {
        await this.login();
        const results = [];

        for (const username of usernames) {
            try {
                await this.page.goto(`https://www.instagram.com/${username}/`);
                await this.page.waitForSelector('button');

                // Find and click follow button
                const followButtons = await this.page.$$('button');
                for (const button of followButtons) {
                    const buttonText = await this.page.evaluate(el => el.textContent, button);
                    if (buttonText.toLowerCase().includes('follow')) {
                        await button.click();
                        await this.page.waitForTimeout(1000);
                        results.push({ username, status: 'Followed successfully' });
                        break;
                    }
                }
            } catch (error) {
                results.push({
                    username,
                    status: 'Follow failed',
                    error: error.message
                });
            }
        }

        // await this.browser.close();
        return results;
    }

    async followFriendsOfFriends(friendsUsernames) {
        await this.login();
        const results = [];

        for (const friend of friendsUsernames) {
            try {
                await this.page.goto(`https://www.instagram.com/${friend}/`);
                await this.page.waitForSelector('button');

                // Find and click the "Following" button to see friends
                const followingButton = await this.page.$('button');
                if (followingButton) {
                    await followingButton.click();
                    await this.page.waitForSelector('div[role="dialog"]'); // Wait for the dialog to open

                    // Get the list of friends
                    const friendUsernames = await this.page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('a'));
                        return elements.map(el => el.textContent).filter(name => name); // Filter out empty names
                    });

                    // Follow each friend
                    for (const username of friendUsernames) {
                        await this.page.goto(`https://www.instagram.com/${username}/`);
                        await this.page.waitForSelector('button');

                        const followButtons = await this.page.$$('button');
                        for (const button of followButtons) {
                            const buttonText = await this.page.evaluate(el => el.textContent, button);
                            if (buttonText.toLowerCase().includes('follow')) {
                                await button.click();
                                await this.page.waitForTimeout(1000); // Wait for 1 second
                                results.push({ username, status: 'Followed successfully' });
                                break;
                            }
                        }
                    }

                    // Close the dialog
                    await this.page.click('button[aria-label="Close"]');
                }
            } catch (error) {
                results.push({
                    username: friend,
                    status: 'Follow failed',
                    error: error.message
                });
            }
        }

        await this.browser.close();
        return results;
    }

    async commentOnFollowersPosts(commentText) {
        await this.login();
        const results = [];

        // Get the list of followers
        await this.page.goto(`https://www.instagram.com/${this.username}/followers/`);
        await this.page.waitForSelector('div[role="dialog"]'); // Wait for the followers dialog to open

        const followersUsernames = await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a'));
            return elements.map(el => el.textContent).filter(name => name); // Filter out empty names
        });

        // Iterate through each follower
        for (const follower of followersUsernames) {
            try {
                await this.page.goto(`https://www.instagram.com/${follower}/`);
                await this.page.waitForSelector('article');

                // Get the first few posts from the follower
                const postLinks = await this.page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links.map(link => link.href).filter(href => href.includes('/p/')).slice(0, 5); // Get first 5 posts
                });

                for (const postLink of postLinks) {
                    await this.page.goto(postLink);
                    await this.page.waitForSelector('textarea');

                    // Comment on the post
                    await this.page.type('textarea', commentText);
                    await this.page.keyboard.press('Enter'); // Submit the comment
                    await this.page.waitForTimeout(1000); // Wait for 1 second

                    results.push({ follower, status: 'Commented successfully' });
                }
            } catch (error) {
                results.push({
                    follower,
                    status: 'Comment failed',
                    error: error.message
                });
            }
        }

        await this.browser.close();
        return results;
    }

    async followFollowersOfFollowers() {
        await this.login();
        const results = [];

        // Get the list of your followers
        await this.page.goto(`https://www.instagram.com/${this.username}/followers/`);
        await this.page.waitForSelector('div[role="dialog"]', { timeout: 60000 }); // Increased timeout to 60 seconds

        const followersUsernames = await this.page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('a'));
            return elements.map(el => el.textContent).filter(name => name); // Filter out empty names
        });

        // Iterate through each follower
        for (const follower of followersUsernames) {
            try {
                await this.page.goto(`https://www.instagram.com/${follower}/`);
                await this.page.waitForSelector('button');

                // Click the "Following" button to see their followers
                const followingButton = await this.page.$('button');
                if (followingButton) {
                    await followingButton.click();
                    await this.page.waitForSelector('div[role="dialog"]', { timeout: 60000 }); // Increased timeout to 60 seconds

                    // Get the list of their followers
                    const followerUsernames = await this.page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('a'));
                        return elements.map(el => el.textContent).filter(name => name); // Filter out empty names
                    });

                    // Follow each follower's follower
                    for (const username of followerUsernames) {
                        await this.page.goto(`https://www.instagram.com/${username}/`);
                        await this.page.waitForSelector('button');

                        const followButtons = await this.page.$$('button');
                        for (const button of followButtons) {
                            const buttonText = await this.page.evaluate(el => el.textContent, button);
                            if (buttonText.toLowerCase().includes('follow')) {
                                await button.click();
                                await this.page.waitForTimeout(1000); // Wait for 1 second
                                results.push({ username, status: 'Followed successfully' });
                                break;
                            }
                        }
                    }

                    // Close the dialog if it exists
                    const closeButton = await this.page.$('button[aria-label="Close"]');
                    if (closeButton) {
                        await closeButton.click();
                    }
                }
            } catch (error) {
                results.push({
                    follower,
                    status: 'Follow failed',
                    error: error.message
                });
            }
        }

        await this.browser.close();
        return results;
    }
}

async function main() {
    const follower = new InstagramFollower();

    try {
        // Follow users based on your followers' followers
        const results = await follower.followFollowersOfFollowers();
        console.log('Follow Results:', results);
    } catch (error) {
        console.error('Operation failed:', error);
    }
}

main();

module.exports = InstagramFollower;