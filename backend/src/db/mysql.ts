import mysql from "mysql2/promise";
import type { AppConfig } from "../config.js";

export type MysqlPool = mysql.Pool;

export function createMysqlPool(config: AppConfig): MysqlPool | null {
  if (!config.DNA_WORK_DB_HOST || !config.DNA_WORK_DB_USER || !config.DNA_WORK_DB_NAME) return null;
  return mysql.createPool({
    host: config.DNA_WORK_DB_HOST,
    port: config.DNA_WORK_DB_PORT,
    user: config.DNA_WORK_DB_USER,
    password: config.DNA_WORK_DB_PASS,
    database: config.DNA_WORK_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 15000,
    timezone: "Z",
  });
}
