# Instagram Follower Manager

This is an automated tool to manage Instagram followers, including features for following, unfollowing, and analyzing follower relationships.

## Features

- Follower scraping
- Unfollower detection
- Comment automation
- Follower management

## Prerequisites

- Node.js (v12 or higher)
- npm

## Installation

1. Clone this repository:
```bash
git clone [your-repo-url]
cd isFollower
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your Instagram credentials:
```
USERNAME=your_instagram_username
PASSWORD=your_instagram_password
```

## Usage

To run the follower scraper:
```bash
node followerScraper.js
```

To run the unfollower detector:
```bash
node unfollowScraper.js
```

To run the comment automation:
```bash
node comment.js
```

## Important Notes

- Make sure to keep your `.env` file secure and never commit it to the repository
- Use this tool responsibly and in accordance with Instagram's terms of service
- Be mindful of rate limits to avoid account restrictions

## License

MIT 