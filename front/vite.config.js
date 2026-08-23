import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, '.', 'VITE_');
    return {
        plugins: [react()],
        base: env.VITE_BASE_PATH || '/GymApp-bot/',
        build: {
            outDir: 'dist',
        },
    };
});
