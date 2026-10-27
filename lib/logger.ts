import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

// Called once at startup, after the log file path is known from the arguments.
export function addLogFile(filename: string): void {
  logger.add(new winston.transports.File({ filename }));
}
