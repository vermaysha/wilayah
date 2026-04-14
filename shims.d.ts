declare module "*.db" {
  // Kita menggunakan import type inline agar tidak merusak global scope
  const value: import("bun:sqlite").Database;
  export default value;
}
