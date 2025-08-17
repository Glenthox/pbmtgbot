# Telegram Data Bot 📱

A Node.js Telegram bot that enables users to purchase data bundles through an interactive interface, integrating with Paystack for secure payments.

## Features

- 🤖 Interactive Telegram bot with button-based navigation
- 📶 Support for MTN and Telecel networks
- 💳 Secure Paystack payment integration
- 📱 Phone number validation
- ✅ Automated data bundle processing
- 🎨 Clean UI with emojis and inline keyboards

## Setup

1. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

2. **Configure environment variables:**
   \`\`\`bash
   cp .env.example .env
   \`\`\`
   
   Fill in your credentials:
   - `TELEGRAM_BOT_TOKEN`: Get from @BotFather on Telegram
   - `PAYSTACK_SECRET_KEY`: Get from your Paystack dashboard
   - `PAYSTACK_PUBLIC_KEY`: Get from your Paystack dashboard

3. **Run the bot:**
   \`\`\`bash
   npm start
   \`\`\`

   For development:
   \`\`\`bash
   npm run dev
   \`\`\`

## Usage

1. Start a chat with your bot on Telegram
2. Send `/start` to begin
3. Choose your network (MTN or Telecel)
4. Select a data package (1GB - 5GB)
5. Enter your phone number
6. Complete payment via Paystack
7. Receive instant data activation

## Data Packages

### MTN
- 1GB - ₦1,000
- 2GB - ₦1,800
- 3GB - ₦2,500
- 4GB - ₦3,200
- 5GB - ₦4,000

### Telecel
- 1GB - ₦950
- 2GB - ₦1,700
- 3GB - ₦2,400
- 4GB - ₦3,100
- 5GB - ₦3,800

## Architecture

- **bot.js**: Main bot logic with all handlers
- **package.json**: Dependencies and scripts
- **README.md**: Documentation

The bot uses:
- `node-telegram-bot-api` for Telegram integration
- `axios` for HTTP requests to Paystack API
- In-memory session storage for user state
- Inline keyboards for interactive navigation

## Deployment

Deploy to any Node.js hosting platform:
- Heroku
- Railway
- DigitalOcean
- AWS EC2
- Vercel (with serverless functions)

Make sure to set environment variables in your hosting platform.
