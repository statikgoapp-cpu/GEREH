// server/types/better-sqlite3.d.ts
declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string, options?: any);
    exec(sql: string): void;
    prepare(sql: string): any;
    close(): void;
  }
  export = Database;
}