import { Router } from 'express';
import * as audit from '../lib/audit.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    if (!audit.isEnabled()) {
      return res.json({ entries: [], total: 0, page: 1, page_size: 0, enabled: false });
    }
    const {
      actor,
      action,
      target,
      success,
      since,
      until,
      page = 1,
      page_size = 50,
    } = req.query;
    const pageNum = Math.max(Number(page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(page_size) || 50, 1), 200);

    const successFilter =
      success === 'true' ? true : success === 'false' ? false : undefined;

    const { entries, total } = await audit.query({
      actor,
      action,
      target,
      success: successFilter,
      since,
      until,
      limit: pageSize,
      offset: (pageNum - 1) * pageSize,
    });

    res.json({
      entries,
      total,
      page: pageNum,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      enabled: true,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
