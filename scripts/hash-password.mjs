#!/usr/bin/env node
// Generates a bcrypt hash for APP_PASSWORD_HASH.
// Usage: node scripts/hash-password.mjs "your password"
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.mjs \"your password\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log("\nAdd this to your environment as APP_PASSWORD_HASH:\n");
console.log(hash);
console.log("");
