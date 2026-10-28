// Gerado pelo capivara a cada passagem do gate 4. Não edite: será sobrescrito.
export default {
  testDir: '.',
  timeout: 60_000,
  reporter: [['list']],
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  outputDir: './resultados',
  projects: [
    { name: "workflow-1", testMatch: "**/workflow-1.spec.ts" },
  ],
  use: {
    baseURL: 'http://127.0.0.1:47533',
    screenshot: 'only-on-failure',
    video: 'off',
    trace: 'off',
  },
  webServer: {
    command: "npm start",
    url: 'http://127.0.0.1:47533',
    reuseExistingServer: false,
    timeout: 180000,
    env: { PORT: '47533', HOST: '127.0.0.1' },
    stdout: 'pipe',
    cwd: '../..',
  },
};
