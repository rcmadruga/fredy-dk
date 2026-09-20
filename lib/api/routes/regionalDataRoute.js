/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { getTaxChoropleth, getSchoolLayer } from '../../services/regionalData/regionalDataService.js';
import logger from '../../services/logger.js';

/**
 * Denmark-only regional data for the map's optional overlays: a kommune tax choropleth and school
 * markers. Both routes always answer 200 - the underlying service degrades to empty data rather than
 * throwing (see `regionalDataService.js`) - so a struggling upstream or a missing school API key
 * shows as "nothing to draw" instead of an error banner over the whole map.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function regionalDataPlugin(fastify) {
  fastify.get('/dk/tax', async (request, reply) => {
    try {
      return await getTaxChoropleth();
    } catch (error) {
      logger.error('Error building the Denmark tax choropleth', error);
      return reply.code(502).send({ error: 'Regional tax data unavailable' });
    }
  });

  fastify.get('/dk/schools', async (request, reply) => {
    try {
      return await getSchoolLayer();
    } catch (error) {
      logger.error('Error fetching Denmark school statistics', error);
      return reply.code(502).send({ error: 'Regional school data unavailable' });
    }
  });
}
