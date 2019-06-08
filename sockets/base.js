const Jimp = require("jimp");
const chalk = require('chalk');

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

const AUTHORIZED = "authorized";

const DELETE_ROOM_TIME = 1000*60*5; //5 minutes

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
		const width = 400, height = 400;
		this.canvas = new Jimp(width, height, 0xffffffff, (err, image) => {
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
	}, DELETE_ROOM_TIME);
	stopDeleteRoomTask = () => clearTimeout(this.deleteRoomTask);

	identifyUserSessionBySocket = socket => this.usersBySocketId[socket.id];

	generateUserToken(name, color){
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
	authenticate(token, socket) {
		// Assert for token
		if(!token){
			return {
				error: `No token provided by socket ${socket.id}`,
			}
		}
		// Check if user profile exists for token
		const userProfile = this.userProfiles[token];
		if(!userProfile){
			return {
				error: `Could not find user profile for ${token} by from ${socket.id}`,
			}
		}
		this.usersBySocketId[socket.id] = new UserSession(socket, userProfile);
		return {
			user: userProfile,
		};
	}

	broadcastMessage(broadcast, message) {
		// Log message
		if(typeof(message) === "object"){
			if(message.type){
				switch(message.type){
					case MESSAGE_TYPES.USER_MESSAGE:
						const {user: {color, name}, message: str} = message;
						this.log(`${chalk.hex(color).bold(`${name}`)}: ${str}`);
						break;
					default: break;
				}
			}
		} else {
			this.log(`[${id}] ${message}`);
		}
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
				client.emit("auth", authResponse); // Send name and color to user
				if(!authResponse.error){
					this.log(`${authResponse.user.name} has connected`);
					this.authSocket(nsp, client); // Add into the authorized room
					// Broadcast welcome message to all users in room
					this.broadcastMessage(nsp.in(AUTHORIZED), {
						type: MESSAGE_TYPES.USER_JOIN, 
						user: authResponse.user,
					});
					// Send current canvas to joined user
					this.canvas.getBufferAsync(Jimp.MIME_PNG)
					.then(buffer=>
						client.emit("canvas", {blob: buffer})
					)
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
				const userSession = this.identifyUserSessionBySocket(client);
				if(!userSession) {
					client.emit("message", "You need to authenticate before sending messages.");
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
					client.emit("message", "You need to authenticate before drawing.");
					return;
				}

				// Check if data exists
				if(!data.blob){ 
					return this.log(`Invalid canvas data received from ${userSession.name}`);
				}

				// Read data
				Jimp.read(data.blob)
				.then(image => {
					if(this.canvas){
						// Combine user drawing with main canvas
						const x = 0, y = 0;
						image.composite(this.canvas, x, y, {  
							mode: Jimp.BLEND_DESTINATION_OVER,
						})
						// Convert to buffer
						.getBufferAsync(Jimp.MIME_PNG)
						// Broadcast new canvas
						.then(buffer=>
							nsp.in(AUTHORIZED).emit("canvas", {blob: buffer})
						)
						.catch(console.error);
						this.canvas = image;
					}
				})
				.catch(err=>this.log(`Unable to read canvas data received from ${userSession.name}`, err));
			});
		});
	}
}

module.exports = Room;