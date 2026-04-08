import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FeatureFlagService } from '../../core/FeatureFlagService';
import { ValidationError } from '../../core/errors';
import { OverrideType } from '../../core/types';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const CreateFlagSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'Flag name may only contain letters, numbers, underscores, and hyphens',
  }),
  description: z.string().optional(),
  globalEnabled: z.boolean().optional().default(false),
});

const UpdateFlagSchema = z.object({
  globalEnabled: z.boolean().optional(),
  description: z.string().optional(),
});

const OverrideSchema = z.object({
  type: z.enum(['user', 'group', 'region']),
  targetId: z.string().min(1, { message: 'targetId must not be empty' }),
  enabled: z.boolean(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const message = result.error.errors.map(e => e.message).join(', ');
    throw new ValidationError(message);
  }
  return result.data;
}

const VALID_OVERRIDE_TYPES: OverrideType[] = ['user', 'group', 'region'];

// ── Router factory ───────────────────────────────────────────────────────────

export function createFlagsRouter(service: FeatureFlagService): Router {
  const router = Router();

  /** GET /api/flags — list all flags */
  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.listFlags());
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/flags — create a flag */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseOrThrow(CreateFlagSchema, req.body);
      res.status(201).json(await service.createFlag(input));
    } catch (err) {
      next(err);
    }
  });

  /** GET /api/flags/:name — get a single flag */
  router.get('/:name', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.getFlag(req.params.name));
    } catch (err) {
      next(err);
    }
  });

  /** PATCH /api/flags/:name — update global state or description */
  router.patch('/:name', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseOrThrow(UpdateFlagSchema, req.body);
      res.json(await service.updateFlag(req.params.name, input));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/flags/:name — delete a flag and its overrides */
  router.delete('/:name', async (req: Request, res: Response, next: NextFunction) => {
    try {
      await service.deleteFlag(req.params.name);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  /** PUT /api/flags/:name/overrides — add or update a user/group/region override */
  router.put('/:name/overrides', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseOrThrow(OverrideSchema, req.body);
      res.json(await service.upsertOverride(req.params.name, input));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/flags/:name/overrides/:type/:targetId — remove a specific override */
  router.delete(
    '/:name/overrides/:type/:targetId',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { name, type, targetId } = req.params;
        if (!VALID_OVERRIDE_TYPES.includes(type as OverrideType)) {
          throw new ValidationError(
            `Invalid override type '${type}'. Must be one of: user, group, region`,
          );
        }
        await service.deleteOverride(name, type as OverrideType, targetId);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  /** POST /api/flags/:name/evaluate — evaluate a flag for a given context */
  router.post('/:name/evaluate', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = {
        userId: typeof req.body.userId === 'string' ? req.body.userId : undefined,
        groupId: typeof req.body.groupId === 'string' ? req.body.groupId : undefined,
        region: typeof req.body.region === 'string' ? req.body.region : undefined,
      };
      res.json(await service.evaluate(req.params.name, context));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
