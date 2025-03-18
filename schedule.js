const cron = require('node-cron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// Schedule the script to run daily at 10:00 AM
const schedule = '0 10 * * *'; // Cron expression for 10:00 AM every day

log.info('🚀 Starting Instagram Follower Scraper Scheduler');
log.info(`⏰ Schedule: ${schedule} (10:00 AM daily)`);

cron.schedule(schedule, () => {
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
});

// Keep the process running
process.on('SIGINT', () => {
    log.info('Shutting down scheduler...');
    process.exit(0);
});

log.success('Scheduler is running. Press Ctrl+C to stop.'); 