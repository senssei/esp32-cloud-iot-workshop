"use strict";

// Env file support

require('dotenv').config()

// Use the Azure IoT device SDK for devices that connect to Azure IoT Central.
var iotHubTransport = require('azure-iot-device-mqtt').Mqtt;
var Client = require('azure-iot-device').Client;
var Message = require('azure-iot-device').Message;
var ProvisioningTransport = require('azure-iot-provisioning-device-mqtt').Mqtt;
var SymmetricKeySecurityClient = require('azure-iot-security-symmetric-key').SymmetricKeySecurityClient;
var ProvisioningDeviceClient = require('azure-iot-provisioning-device').ProvisioningDeviceClient;

const provisioningHost = 'global.azure-devices-provisioning.net';

var idScope = process.env.ID_SCOPE;
var registrationId = process.env.DEVICE_ID;
var symmetricKey = process.env.PRIMARY_KEY;

var provisioningSecurityClient = new SymmetricKeySecurityClient(registrationId, symmetricKey);
var provisioningClient = ProvisioningDeviceClient.create(provisioningHost, idScope, new ProvisioningTransport(), provisioningSecurityClient);
var hubClient;

var baseHal = 0;
var ledOn = true;

// Send simulated device telemetry.
function sendTelemetry() {
    var hal = Math.round(baseHal + (Math.random() * 15));

    var data = JSON.stringify({
        Hal: hal
    });

    var message = new Message(data);
    hubClient.sendEvent(message, (err, res) => console.log(`Sent message: ${message.getData()}` +
        (err ? `; error: ${err.toString()}` : '') +
        (res ? `; status: ${res.constructor.name}` : '')));
}

// Send device twin reported properties.
function sendDeviceProperties(twin, properties) {
    twin.properties.reported.update(properties, (err) => console.log(`Sent device properties: ${JSON.stringify(properties)}; ` +
        (err ? `error: ${err.toString()}` : `status: success`)));
}

// Add any writeable properties your device supports,
// mapped to a function that's called when the writeable property
// is updated in the IoT Central application.
var writeableProperties = {
    'name': (newValue, callback) => {
        setTimeout(() => {
            callback(newValue, 'completed', 200);
        }, 1000);
    },
    'brightness': (newValue, callback) => {
        setTimeout(() => {
            callback(newValue, 'completed', 200);
        }, 5000);
    }
};

// Handle writeable property updates that come from IoT Central via the device twin.
function handleWriteablePropertyUpdates(twin) {
    twin.on('properties.desired', function (desiredChange) {
        for (let setting in desiredChange) {
            if (writeableProperties[setting]) {
                console.log(`Received setting: ${setting}: ${desiredChange[setting]}`);
                writeableProperties[setting](desiredChange[setting], (newValue, status, code) => {
                    var patch = {
                        [setting]: {
                            value: newValue,
                            ad: status,
                            ac: code,
                            av: desiredChange.$version
                        }
                    }
                    sendDeviceProperties(twin, patch);
                });
            }
        }
    });
}

// Setup command handlers
function setupCommandHandlers(twin) {

    // Handle synchronous LED blink command with request and response payload.
    function onBlink(request, response) {
        console.log('Received synchronous call to blink');
        var responsePayload = {
            status: 'Blinking LED every 5 seconds'
        }
        response.send(200, responsePayload, (err) => {
            if (err) {
                console.error('Unable to send method response: ' + err.toString());
            } else {
                console.log('Blinking LED every 5 seconds');
            }
        });
    }
  
    hubClient.onDeviceMethod('BlinkLED', onBlink);
}

// Handle device connection to Azure IoT Central.
var connectCallback = (err) => {
    if (err) {
        console.log(`Device could not connect to Azure IoT Central: ${err.toString()}`);
    } else {
        console.log('Device successfully connected to Azure IoT Central');

        // Send telemetry to Azure IoT Central every 1 second.
        setInterval(sendTelemetry, 1000);

        // Get device twin from Azure IoT Central.
        hubClient.getTwin((err, twin) => {
            if (err) {
                console.log(`Error getting device twin: ${err.toString()}`);
            } else {
                // Send device properties once on device start up.
                var properties = {
                    Model: 'ESP32-fake',
                    Features: 'XXX',
                    Cores: '1'
                };
                sendDeviceProperties(twin, properties);

                handleWriteablePropertyUpdates(twin);

                setupCommandHandlers(twin);
            }
        });
    }
};

// Start the device (register and connect to Azure IoT Central).
provisioningClient.register((err, result) => {
    if (err) {
        console.log('Error registering device: ' + err);
    } else {
        console.log('Registration succeeded');
        console.log('Assigned hub=' + result.assignedHub);
        console.log('DeviceId=' + result.deviceId);
        var connectionString = 'HostName=' + result.assignedHub + ';DeviceId=' + result.deviceId + ';SharedAccessKey=' + symmetricKey;
        hubClient = Client.fromConnectionString(connectionString, iotHubTransport);

        hubClient.open(connectCallback);
    }
});