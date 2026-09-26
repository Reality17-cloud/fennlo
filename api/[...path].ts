import 'dotenv/config';
import { createFennloHttpApp } from '../server/bootstrap.js';

const { app } = await createFennloHttpApp({ production: true });

export default app;
