module.exports = {
  apps: [{
    name: "kuber-backend",
    script: "./server.js",
    instances: 1,
    exec_mode: "cluster",
    env_production: {
      NODE_ENV: "production",
      PORT: 5001
    }
  }]
};