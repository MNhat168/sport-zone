# Database Scripts Walkthrough

I have created the requested scripts to initialize the MongoDB database and seed it with demo data.

## 1. Database Setup Script
**File**: [scripts/setup-db.ts](file:///e:/Capstone-project/BE/scripts/setup-db.ts)

This script initializes all collections and synchronizes indexes for the key entities (User, Field, Booking, etc.) to ensure the database schema is ready.

### Usage
Run the script using `ts-node`:
```bash
npx ts-node -r tsconfig-paths/register scripts/setup-db.ts
```

## 2. Seed Data Script
**File**: [scripts/mock-data/import-cli.ts](file:///e:/Capstone-project/BE/scripts/mock-data/import-cli.ts)

I updated the existing CLI importer to include support for **Users** and **Reviews**.
New mock data files:
- [scripts/mock-data/user-library.json](file:///e:/Capstone-project/BE/scripts/mock-data/user-library.json)
- [scripts/mock-data/review-library.json](file:///e:/Capstone-project/BE/scripts/mock-data/review-library.json)

### Usage
Run the seed command with the new flags:
```bash
# Import Users
npm run import:mock -- --users

# Import Reviews (requires users and fields/coaches to exist first)
npm run import:mock -- --reviews

# Run all (example)
npm run import:mock -- --users --fields --reviews
```
