module.exports = {
  apps: [
    {
      name: 'psx-backend',
      script: './backend/src/index.js',
      cwd: './',
      instances: 1,          // single instance (state is in-memory)
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 20,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/backend-error.log',
      out_file:   './logs/backend-out.log',
      merge_logs: true,
    },
  ],
};
