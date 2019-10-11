const Jimp = require("jimp");
const {getOwnProperty} = require('../util');

// Classes
class UserProfile {
	constructor(name, color){
		this.name = name;
		this.color = color;
	}
}
class UserSession {
	constructor(socket, profile, room){
		this.socket = socket;
		this.room = room;
		this.profile = profile;
		this.id = socket.id;
	};
}

// Constants
const MESSAGE_TYPES = Object.freeze({
	USER_MESSAGE: "user_message",
	USER_JOIN: "user_join",
	USER_DISCONNECT: "user_disconnect",
});

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 500;

const AUTHORIZED = "authorized";

const EXPIRE_TIME = 1000*60*5; //5 minutes

// Utility functions
const isNonNegativeNumberFn = v => () => typeof(v) === "number" && v >= 0;
const isNotNullFn = v => () => !v === false;

class Room {
	constructor(io, id, deleteRoom){
		this.userProfiles = {};
		this.usersBySocketId = {};
		this.io = io;
		this.id = id;
		this.deleteRoom = deleteRoom;
		this.deleteRoomTask = null;
		this.numUsers = 0;
		// Initialize with a blank white canvas
		this.canvas = new Jimp(DEFAULT_WIDTH, DEFAULT_HEIGHT, 0xffffffff, (err, image) => {
			if(err){
				console.error(err);
				return;
			}
			image.opaque();
		});
		this.closeSockets = this.openSockets(io, id);
		this.startDeleteRoomTask(deleteRoom);
	}

	log = (...logParams) => console.log(`[${this.id}]`, ...logParams);
	error = (...logParams) => console.error(`[${this.id}]`, ...logParams);

	startDeleteRoomTask = () => this.deleteRoomTask = setTimeout(()=>{
		this.closeSockets();
		this.deleteRoom();
	}, EXPIRE_TIME);
	stopDeleteRoomTask = () => clearTimeout(this.deleteRoomTask);

	identifyUserSessionBySocket = socket => this.usersBySocketId[socket.id];

	generateUserToken(name, color){
		name = name.trim();
		if(!name || !color){
			return null;
		}
		// Choose a random hash for the token
		let t;
		do {
			t = Math.random().toString(36).substring(7);
		} while (this.userProfiles[t]);
		// TODO: Maybe let tokens expire after some time
		this.userProfiles[t] = new UserProfile(name, color);
		return t;
	}
	hasToken = token => getOwnProperty(this.userProfiles, token) !== undefined;
	authenticate(token, socket) {
		// Assert for token
		if(!token){
			return {
				error: `No token provided by socket ${socket.id}.`,
			}
		}
		// Check if user profile exists for token
		const userProfile = getOwnProperty(this.userProfiles, token);
		if(!userProfile){
			return {
				error: `Could not find user profile for ${token} by from ${socket.id}.`,
			}
		}
		this.usersBySocketId[socket.id] = new UserSession(socket, userProfile);
		return {
			user: userProfile,
		};
	}
	broadcastMessage(broadcast, message) {
		broadcast.emit("message", message);
	}
	openSockets(io, roomId){
		const nsp = io.of(roomId);
		const onConnect = client => {
			this.numUsers++;
			this.stopDeleteRoomTask(); // Cancel delete room task
			// Disconnect the client if not authenticated within a timeframe
			const disconnectTask = setTimeout(()=>{
				client.disconnect(true);
				this.error(`Disconnected socket ${client.id}; Reason: No response`);
			},5000);
			// User authenticates to gain access to socket
			client.once("auth", token => {
				const authResponse = this.authenticate(token, client);
				 // Send name and color to user
				client.emit("auth", {
					user: authResponse.user,
					error: authResponse.error && "Failed to authenticate"
				});
				if(!authResponse.error){
					this.log(`${authResponse.user.name} has connected.`);
					this.authSocket(nsp, client); // Add into the authorized room
					// Broadcast welcome message to all users in room
					this.broadcastMessage(nsp.in(AUTHORIZED), {
						type: MESSAGE_TYPES.USER_JOIN, 
						user: authResponse.user,
					});
					// Send current canvas to joined user
					this.canvas.getBufferAsync(Jimp.MIME_PNG)
					.then(buffer=>{
						const {bitmap: {width, height}} = this.canvas;
						client.emit("canvas", {buffer, x: 0, y: 0, width, height, setWidth: width, setHeight: height});
					})
					.catch(console.error);
					clearTimeout(disconnectTask); // Cancel disconnect task
				} else {
					client.disconnect(true);
					console.error(authResponse.error);
				}
			});
			client.once("disconnect", () => {
				this.numUsers--;
				if(this.numUsers === 0) {
					// Prepare to delete room if no one is on
					this.startDeleteRoomTask();
				}
			});
		}
		nsp.on('connection', onConnect);
		// Return function to remove listener
		return ()=>{
			nsp.off('connection', onConnect);
		}
	}
	authSocket = (nsp, client) => {
		client.join(AUTHORIZED,()=>{
			client.once('disconnect', reason => {
				const userSession = this.identifyUserSessionBySocket(client);
				if(userSession){
					delete this.usersBySocketId[client.id];
					this.log(`${userSession.profile.name} has disconnected. Reason: ${reason}`);
					this.broadcastMessage(nsp.in(AUTHORIZED), {
						type: MESSAGE_TYPES.USER_DISCONNECT, 
						user: userSession.profile,
					});
				}
			});

			// User sends chat message
			// input string: message
			client.on("message", message => {
				if(message.length > 1000){
					return; // Cancel message if above the character limit (Also enforced on the client-side)
				}
				const userSession = this.identifyUserSessionBySocket(client);
				if(!userSession) {
					this.error("Invalid user:", userSession);
					return;
				}
				const m = {
					message,
					type: MESSAGE_TYPES.USER_MESSAGE,
					user: userSession.profile,
				}
				this.broadcastMessage(client.in(AUTHORIZED), m, userSession);
			});

			// User sends a canvas update
			client.on("canvas", data => {
				const userSession = this.identifyUserSessionBySocket(client);
				if(!userSession) {
					this.error("Invalid user:", userSession);
					return;
				}

				// Check if data is valid
				const {blob, x, y, width, height} = data;
				const validityChecks = [
					isNotNullFn(blob),
					isNonNegativeNumberFn(x),
					isNonNegativeNumberFn(y),
					isNonNegativeNumberFn(width),
					isNonNegativeNumberFn(height),
				];
				for(let fn of validityChecks){
					if(!fn()){
						return this.log(`Invalid canvas data received from ${userSession.profile.name}`);
					}
				}

				// Read data
				Jimp.read(blob)
				.then(image => {
					if(this.canvas){
						// Combine main canvas with user drawing
						this.canvas.composite(image, x, y, {  
							mode: Jimp.BLEND_SOURCE_OVER,
						})
						// Make a copy
						.clone()
						// Crop within user drawing boundaries
						.crop(x, y, width, height)
						// Convert to buffer
						.getBufferAsync(Jimp.MIME_PNG)
						// Broadcast new canvas
						.then(buffer=>
							nsp.in(AUTHORIZED).emit("canvas", {buffer, x, y, width, height})
						)
						.catch(console.error);
					}
				})
				.catch(err=>this.log(`Unable to read canvas data received from ${userSession.profile.name}: `, err));
			});
			
			// User resizes the canvas
			client.on("resize", data => {
				const userSession = this.identifyUserSessionBySocket(client);
				if(!userSession) {
					this.error("Invalid user:", userSession);
					return;
				}

				// Check if data is valid
				const {width, height} = data;
				const validityChecks = [
					isNonNegativeNumberFn(width),
					isNonNegativeNumberFn(height),
				];
				for(let fn of validityChecks){
					if(!fn()){
						return this.log(`Invalid resize received from ${userSession.profile.name}`);
					}
				}

				// Enforce size limit
				if(width > 2000 || height > 2000){
					return;
				}
				
				// Send updated canvas
				if(this.canvas){
					const b = this.canvas.bitmap; 
					// Reducing canvas
					if(width < b.width)
						this.canvas.cover(width, b.height);
					if(height < b.height)
						this.canvas.cover(b.width, height);

					// Extending canvas
					if(width > b.width)
						this.canvas.contain(width, b.height);
					if(height > b.height)
						this.canvas.contain(b.width, height);

					this.canvas.getBufferAsync(Jimp.MIME_PNG)
					.then(buffer=>{
						const {bitmap: {width, height}} = this.canvas;
						nsp.in(AUTHORIZED).emit("canvas", {buffer, x: 0, y: 0, width, height, setWidth: width, setHeight: height});
					})
					.catch(console.error);
				}
					
			});
		});
	}
}

module.exports = Room;