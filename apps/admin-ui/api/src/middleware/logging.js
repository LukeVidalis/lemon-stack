import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';

const isProd = process.env.NODE_ENV === 'production';

const QUIET_PATHS = new Set(['/api/health', '/api/ready']);

export const httpLogger = pinoHttp({
  level: process.env.LOG_LEVEL || 'info',
  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => QUIET_PATHS.has(req.url),
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      actor: req.headers?.['x-authentik-username'] || undefined,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,req.id,reqId' },
      },
});
