const https = require("https");
const { performance } = require("perf_hooks");
const Monitor = require("../models/Monitor");
const MonitorLog = require("../models/MonitorLog.js");

const { sendDowntimeAlert } = require("./emailService");

async function monitorWebsite(monitor) {
  const start = performance.now();
  let tcpHandshakeTime = 0;
  let sslHandshakeTime = 0;

  const req = https.get(monitor.url, (res) => {
    const dnsLookupTime = performance.now();

    res.on("data", () => {}); // Optional: handle response body if needed.

    res.on("end", async () => {
      const end = performance.now();
      const metrics = {
        statusCode: res.statusCode,
        responseTime: end - start,
        dnsLookupTime: dnsLookupTime - start,
        tcpHandshakeTime: tcpHandshakeTime, // Update after capturing time
        sslHandshakeTime: sslHandshakeTime, // Update after capturing time
      };

      // Save metrics to the database
      await MonitorLog.create({
        monitor: monitor._id,
        ...metrics,
        success: true,
      });

      console.log(`Monitor ${monitor.monitorName}: Log saved.`);
    });
  });

  req.on("socket", (socket) => {
    socket.once("lookup", () => {
      tcpHandshakeTime = performance.now() - start; // Time until TCP handshake
    });

    socket.once("secureConnect", () => {
      sslHandshakeTime = performance.now() - start; // Time until SSL handshake completes
    });
  });

  req.on("error", async (err) => {
    console.error(`Monitor ${monitor.monitorName} failed:`, err.message);
    await MonitorLog.create({
      monitor: monitor._id,
      statusCode: 0,
      responseTime: 0,
      dnsLookupTime: 0,
      tcpHandshakeTime: 0,
      sslHandshakeTime: 0,
      success: false,
    });

    // Send downtime alert email
    await sendDowntimeAlert(
      monitor.user, // Using `monitor.user` for email
      monitor.monitorName,
      monitor.url
    );
  });

  req.end();
}

// Function to loop through all monitors and schedule checks
async function startMonitoring() {
  const monitors = await Monitor.find(); // Fetch all monitors

  monitors.forEach((monitor) => {
    // Clear any previous intervals (if necessary)
    if (monitor.intervalId) {
      clearInterval(monitor.intervalId);
    }

    // Schedule monitoring at the specified interval
    monitor.intervalId = setInterval(() => {
      monitorWebsite(monitor);
    }, monitor.interval * 1000); // Convert seconds to milliseconds
  });
}

module.exports = { startMonitoring };
