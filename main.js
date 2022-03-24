const { CallClient, VideoStreamRenderer, LocalVideoStream } = require('@azure/communication-calling');
const { AzureCommunicationTokenCredential } = require('@azure/communication-common');
const { AzureLogger, setLogLevel } = require("@azure/logger");

setLogLevel('error');
AzureLogger.log = (...args) => {
    console.log(...args);
};

const refreshTokenButton = document.getElementById('RefreshToken-button');
const copyIdButton = document.getElementById('CopyAcsId-button');
const testConnectButton = document.getElementById('test-connect-button');
const connectButton = document.getElementById('connect-button');
const disconnectButton = document.getElementById('disconnect-button');
const autoAcceptCb = document.getElementById('autoacceptcall');
const acceptButton = document.getElementById('answer-button');
const rejectButton = document.getElementById('reject-button');
const incomingCallStatus = document.getElementById('incoming-call-status');
const callStateLabel = document.getElementById('call-state');
const tokenExpireLabel = document.getElementById('token-expire');
const identityElement = document.getElementById('identity');
const destinationUserId = document.getElementById('destination-user-id');

let call;
let deviceManager;
let callAgent;
let incomingCall;
let localVideoStream;
let localVideoStreamRenderer;
let isDevice = false;

async function init() {

    try {

        var args = new Object;
        url = location.search.substring(1).split('&');

        for (i = 0; url[i]; i++) {
            var k = url[i].split('=');
            args[k[0]] = k[1];
        }
        console.log("Arg = ", args.PageType);

        document.getElementById('PageType').innerHTML = args.PageType;
        isDevice = args.PageType == "Device";
        console.log("Is Device Page ? ", isDevice);

        if (isDevice) {
            document.getElementById('incomingCallRow').hidden = true;
            document.getElementById('PageDescriptionDevice').hidden = false;
            document.getElementById('localVideoHeader').hidden = false;
            document.getElementById('localVideoWindow').hidden = false;
        }
        else {
            connectButton.hidden = true;
            document.getElementById('destinationRow').hidden = true;
            document.getElementById('PageDescriptionCloud').hidden = false;
            document.getElementById('remoteVideoHeader').hidden = false;
            document.getElementById('remoteVideoWindow').hidden = false;
        }
        // Call Azure Functions to get ID and Token.
        const callClient = new CallClient();
        const response = await fetch('https://pixseefunction.azurewebsites.net/api/GetToken', {
            method: 'GET',
            headers: {
                'Content-Type': 'applicaiton/json'
            },
        })

        const responseJson = await response.json();
        const responseContent = JSON.parse(responseJson.content);
        const token = responseContent.token;
        const tokenCredential = new AzureCommunicationTokenCredential(token);
        callAgent = await callClient.createCallAgent(tokenCredential);

        // Fill out UI nad enable buttons
        identityElement.innerText = responseContent.userId;
        copyIdButton.disabled = false;
        tokenExpireLabel.innerText = responseContent.expiresOn;
        refreshTokenButton.disabled = false;

        //get all the cameras, then choose the first one
        deviceManager = await callClient.getDeviceManager();
        videoDevices = await deviceManager.getCameras();

        setButtons(false);

        if (videoDevices.length == 0) {
            console.error("Camera not found");
            callStateLabel.innerText = "Camera not found";
            localVideoStream = null;
        }
        else {
            await deviceManager.askDevicePermission({ video: true });
            await deviceManager.askDevicePermission({ audio: true });
            videoDeviceInfo = videoDevices[0];
            localVideoStream = new LocalVideoStream(videoDeviceInfo);
            callStateLabel.innerText = "Initialized";
        }

        callAgent.on('incomingCall', async (call) => {
            incomingCall = call.incomingCall;
            incomingCallStatus.innerText = "Incoming Call from - " + incomingCall.callerInfo.identifier.communicationUserId;

            if (autoAcceptCb.checked) {
                await acceptCall();
            }
            else {
                acceptButton.disabled = rejectButton.disabled = false;
            }
        });
    } catch (e) {
        console.error(e);
    }
}

init();

async function acceptCall() {
    try {
        console.log("AcceptCall");
        const localVideoStream = await createLocalVideoStream();
        const videoOptions = localVideoStream ? { localVideoStreams: [localVideoStream] } : undefined;
        call = await incomingCall.accept({ videoOptions });
        subscribeCall(call);
    }
    catch (error) {
        console.error(error);
    }

}

async function createLocalVideoStream() {
    const camera = (await deviceManager.getCameras())[0];
    if (camera) {
        return new LocalVideoStream(camera);
    } else {
        console.error(`No camera device found on the system`);
    }
}

function setButtons(isCallInProgress) {

    testConnectButton.disabled = isCallInProgress;
    disconnectButton.disabled = !isCallInProgress;
    connectButton.disabled = isCallInProgress;
}

function subscribeCall(call) {

    try {

        console.log(`Call Id: ${call.id}`);
        console.log(`Call state: ${call.state}`);
        call.on('stateChanged', async () => {

            if (call.state === 'Connected') {
                disconnectButton.disabled = false;
            }
            callStateLabel.innerText = call.state;
            console.log(`Call state changed: ${call.state}`);

            if (call.state === 'Connecting') {
                setButtons(true);
            } else if (call.state === 'Disconnected') {
                console.log(`Call ended, call end reason={code=${call.callEndReason.code}, subCode=${call.callEndReason.subCode}}`);
                setButtons(false);
            }
        });

        if (isDevice) {
            call.localVideoStreams.forEach(async (lvs) => {
                localVideoStream = lvs;
                await displayLocalVideoStream();
            });

            call.on('localVideoStreamsUpdated', e => {
                e.added.forEach(async (lvs) => {
                    localVideoStream = lvs;
                    await displayLocalVideoStream();
                });
                e.removed.forEach(lvs => {
                    removeLocalVideoStream();
                });
            });

        }
        else {
            call.remoteParticipants.forEach(remoteParticipant => {
                subscribeToRemoteParticipant(remoteParticipant);
            });
        }

    }
    catch (error) {
        console.error(error);
    }
}

copyIdButton.onclick = function () {
    navigator.clipboard.writeText(identityElement.innerText);
}

refreshTokenButton.onclick = function () {
    console.log("Not Implemented Yet");
}

testConnectButton.onclick = async () => {

    try {

        const destinationToCall = { id: '8:echo123' };

        setButtons(true);

        call = callAgent.startCall([destinationToCall]);

        subscribeCall(call);

    }
    catch (error) {
        console.error(error);
    }
};

connectButton.onclick = async () => {

    if (destinationUserId.value.length == 0) {
        window.alert("Enter Destination ID");
        return;
    }

    const destinationToCall = { communicationUserId: destinationUserId.value };

    if (localVideoStream) {
        const callOptions = { videoOptions: { localVideoStreams: [localVideoStream] } };
        call = callAgent.startCall([destinationToCall], callOptions);
    }
    else {
        call = callAgent.startCall([destinationToCall]);
    }

    subscribeCall(call);
};

disconnectButton.onclick = async () => {
    await call.hangUp();
    incomingCallStatus.innerText = "";
    setButtons(false);
};

autoAcceptCb.onchange = function () {
    acceptButton.disabled = autoAcceptCb.checked;
    rejectButton.disabled = autoAcceptCb.checked;
}

acceptButton.onclick = async () => {
    await acceptCall();
}

rejectButton.onclick = async () => {
    incomingCall.reject();
}

async function displayLocalVideoStream() {
    try {
        localVideoStreamRenderer = new VideoStreamRenderer(localVideoStream);
        const view = await localVideoStreamRenderer.createView();
        document.getElementById("localVideo").appendChild(view.target);
    } catch (error) {
        console.error(error);
    }
}

async function removeLocalVideoStream() {
    try {
        localVideoStreamRenderer.dispose();
    } catch (error) {
        console.error(error);
    }
}

function subscribeToRemoteParticipant(remoteParticipant) {
    try {
        // Inspect the initial remoteParticipant.state value.
        console.log(`Remote participant state: ${remoteParticipant.state}`);
        // Subscribe to remoteParticipant's 'stateChanged' event for value changes.
        remoteParticipant.on('stateChanged', () => {
            console.log(`Remote participant state changed: ${remoteParticipant.state}`);

            if (remoteParticipant.state === 'Connected') {
                setButtons(true);
            } else if (call.state === 'Disconnected') {
                setButtons(false);
            }

        });

        if (!isDevice) {
            // Inspect the remoteParticipants's current videoStreams and subscribe to them.
            remoteParticipant.videoStreams.forEach(remoteVideoStream => {
                subscribeToRemoteVideoStream(remoteVideoStream)
            });
            // Subscribe to the remoteParticipant's 'videoStreamsUpdated' event to be
            // notified when the remoteParticiapant adds new videoStreams and removes video streams.
            remoteParticipant.on('videoStreamsUpdated', e => {
                // Subscribe to new remote participant's video streams that were added.
                e.added.forEach(remoteVideoStream => {
                    subscribeToRemoteVideoStream(remoteVideoStream)
                });
                // Unsubscribe from remote participant's video streams that were removed.
                e.removed.forEach(remoteVideoStream => {
                    console.log('Remote participant video stream was removed.');
                })
            });
        }

    } catch (error) {
        console.error(error);
    }
}

async function subscribeToRemoteVideoStream(remoteVideoStream) {
    // Create a video stream renderer for the remote video stream.
    let videoStreamRenderer = new VideoStreamRenderer(remoteVideoStream);
    let view;
    const renderVideo = async () => {
        try {
            view = await videoStreamRenderer.createView();
            document.getElementById("remoteVideo").appendChild(view.target);
        } catch (e) {
            console.warn(`Failed to createView, reason=${e.message}, code=${e.code}`);
        }
    }

    remoteVideoStream.on('isAvailableChanged', async () => {
        // Participant has switched video on.
        if (remoteVideoStream.isAvailable) {
            await renderVideo();

            // Participant has switched video off.
        } else {
            if (view) {
                view.dispose();
                view = undefined;
            }
        }
    });

    // Participant has video on initially.
    if (remoteVideoStream.isAvailable) {
        await renderVideo();
    }
}