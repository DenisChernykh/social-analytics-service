import { createScheduledOperations } from '../../backend/src/app/create-features';
export default {scheduled(_controller: unknown,env: any,ctx: any){ctx.waitUntil(createScheduledOperations(env).tick());}};
