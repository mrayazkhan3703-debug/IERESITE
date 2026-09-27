// Synthetic unit-suite key set BEFORE any cached application config is loaded.
// This file is never loaded by web/worker runtime or integration commands.
process.env.AUTH_MFA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
