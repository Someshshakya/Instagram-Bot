const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// MongoDB connection string from environment
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MAX_FOLLOWS = 100;

// Configure logging
const logFile = path.join(__dirname, 'scheduler.log');
const log = {
    info: (message) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[SCHEDULER] ℹ️ ${timestamp} - ${message}\n`;
        console.log(logMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    error: (message) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[SCHEDULER] ❌ ${timestamp} - ${message}\n`;
        console.error(logMessage);
        fs.appendFileSync(logFile, logMessage);
    },
    success: (message) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[SCHEDULER] ✅ ${timestamp} - ${message}\n`;
        console.log(logMessage);
        fs.appendFileSync(logFile, logMessage);
    }
};

// Function to check follow count in MongoDB
async function checkFollowCount() {
    const client = new MongoClient(MONGODB_URI);
    try {
        await client.connect();
        const database = client.db('instagram_bot');
        const statsCollection = database.collection('follow_stats');

        const stats = await statsCollection.findOne({ _id: 'follow_stats' });

        // If no stats exist, return 0
        if (!stats) return 0;

        // Check if todayDate exists and is from today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (!stats.todayDate || new Date(stats.todayDate) < today) {
            // Reset followsToday if it's a new day
            await statsCollection.updateOne(
                { _id: 'follow_stats' },
                {
                    $set: {
                        followsToday: 0,
                        todayDate: today
                    }
                }
            );
            log.info('Reset daily follow counter for new day');
        }

        return stats.totalFollows || 0;
    } catch (error) {
        log.error(`Error checking follow count: ${error.message}`);
        return 0;
    } finally {
        await client.close();
    }
}

// Function to run the follower scraper
async function runFollowerScraper() {
    const followCount = await checkFollowCount();

    if (followCount >= MAX_FOLLOWS) {
        log.info(`Reached maximum follow limit (${MAX_FOLLOWS}). Stopping scheduler.`);
        process.exit(0);
        return;
    }

    log.info(`Current follow count: ${followCount}/${MAX_FOLLOWS}`);
    log.info('Starting scheduled Instagram follower scraper...');

    // Get the absolute path to the script
    const scriptPath = path.join(__dirname, 'followerScraper.js');

    // Check if the script exists
    if (!fs.existsSync(scriptPath)) {
        log.error(`Script not found at: ${scriptPath}`);
        return;
    }

    // Run the script
    const process = exec(`node ${scriptPath}`, (error, stdout, stderr) => {
        if (error) {
            log.error(`Error running script: ${error.message}`);
            return;
        }

        // Log the output
        if (stdout) {
            log.info(`Script output:\n${stdout}`);
        }

        if (stderr) {
            log.error(`Script errors:\n${stderr}`);
        }

        log.success('Script execution completed');
    });

    // Handle process events
    process.on('error', (error) => {
        log.error(`Failed to start script: ${error.message}`);
    });

    process.on('exit', (code) => {
        log.info(`Script exited with code: ${code}`);
    });
}

// Schedule the script to run daily at 10:00 AM
const schedule = '0 10 * * *'; // Cron expression for 10:00 AM every day

log.info('🚀 Starting Instagram Follower Scraper Scheduler');
log.info(`⏰ Schedule: ${schedule} (10:00 AM daily)`);

// Run immediately on startup
runFollowerScraper();

// Schedule daily runs
cron.schedule(schedule, runFollowerScraper);

// Keep the process running
process.on('SIGINT', () => {
    log.info('Shutting down scheduler...');
    process.exit(0);
});

log.success('Scheduler is running. Press Ctrl+C to stop.'); 