import winston from "winston";

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      const details = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : "";
      return `${timestamp} ${level}: ${message}${details}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

// Called once at startup, after the log file path is known from the arguments.
export function addLogFile(filename: string): void {
  logger.add(new winston.transports.File({ filename }));
}
