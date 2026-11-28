// What a media provider needs of its connection (lib/providers/endpoints.ts)
import type { Endpoint } from '../../lib/providers/endpoints';

export type Connection = Pick<Endpoint, 'id' | 'baseUrl'>;
