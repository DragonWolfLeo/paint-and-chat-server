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

// Test variables
const INITIAL_USER_PROFILES = Object.freeze({
	user: new UserProfile("User", "#009900"),
	leo: new UserProfile("Dragon Wolf Leo", "#FF6600"),
	luka: new UserProfile("Luka Loginska", "#0051F3"),
	vada: new UserProfile("VAdaPEGA", "#FF0000"),
});

// // Mock database structure
// const mockLoginDatabase = {
// 	users: {
// 		user: {
// 			pass: "users_pass",
// 		},//User: object
// 		leo: {
// 			pass: "users_pass",
// 		},//User: object
// 		luka: {
// 			pass: "users_pass",
// 		},//User: object
// 		vada: {
// 			pass: "users_pass",
// 		},//User: object
// 	},//Array<User>: object[string:userLogin],
// };


class Room {
	constructor(io, namespace){
		// User profiles; Non-sensitive user data goes here
		this.userProfiles = {...INITIAL_USER_PROFILES}
		this.activeUsers = {};
		this.io = io;
		this.namespace = namespace;
		// Initialize with a blank white canvas
		const width = 400, height = 400;
		this.canvas = new Jimp(width, height, 0xffffffff, (err, image) => {
			if(err){
				console.error(err);
				return;
			}
			image.opaque();
		});
		this.openSockets(io, namespace);
	}
	log(...logParams){
		console.log(`[${this.namespace}]`, ...logParams);
	}
	authenticate(userLogin, socket) {
		// Assert: That room exists
		// if(!room){
		// 	return {
		// 		token: null,
		// 		user: null,
		// 		error: `Room ${room.id} does not exist`,
		// 	};
		// }
		// // Assert: User/Password is correct
		// const correctPass = 
		// 	mockLoginDatabase.users[userLogin] !== null && 
		// 	mockLoginDatabase.users[userLogin].pass === userPass;
		// if(!correctPass)
		// 	return {
		// 		error: `Incorrect login/password for ${userLogin}`,
		// 	};
		// Assign new token then return it
		const token = Math.random().toString(36).substring(7);

		const userProfile = this.userProfiles[userLogin];
		this.activeUsers[socket.id] = new UserSession(socket, userProfile);
		
		if(!userProfile){
			return {
				error: `Could not find user profile for ${userLogin}`,
			}
		}
		return {
			token,
			user: userProfile,
		};
	}

	identifyUserSessionBySocket(socket) {
		return this.activeUsers[socket.id];
	}

	broadcastMessage(broadcast, message) {
		// Log message
		if(typeof(message) === "object"){
			if(message.type){
				switch(message.type){
					case MESSAGE_TYPES.USER_MESSAGE:
						const {user: {color, name}, message: str} = message;
						this.log(`[${this.namespace}] ${chalk.hex(color).bold(`${name}`)}: ${str}`);
						break;
					default: break;
				}
			}
		} else {
			this.log(`[${namespace}] ${message}`);
		}
		broadcast.emit("message", message);
	}
	openSockets(io, namespace){
		const nsp = io.of(namespace);
		nsp.on('connection', client => {
			// User authenticates to get a valid authToken
			// Message 1: Sent to user online
			// input string: login
			// input string: pass
			// input string: room
			// returns string: token
			// returns string: error
			// returns User: user
			// Message 2: Broadcasted to all users in room
			// return string (message)
			client.on("auth", jsonString => {
				const authData = JSON.parse(jsonString);
				const authResponseJson = this.authenticate(authData.login, client);
				client.emit("auth", JSON.stringify(authResponseJson));
				if(!authResponseJson.error){
					this.log(`${authResponseJson.user.name} has connected`);
					const welcomeMessage = {
						type: MESSAGE_TYPES.USER_JOIN, 
						user: authResponseJson.user, 
					};
					this.broadcastMessage(nsp, welcomeMessage);
					// Send current canvas to joined user
					this.canvas.getBufferAsync(Jimp.MIME_PNG)
					.then(buffer=>
						client.emit("canvas", {blob: buffer})
					)
					.catch(console.error);
				}
			});

			client.on('disconnect', reason => {
				const userSession = this.identifyUserSessionBySocket(client);
				if(userSession){
					this.log(`${userSession.profile.name} has disconnected. Reason: ${reason}`);
					this.broadcastMessage(nsp, {
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
				this.broadcastMessage(client.broadcast, m, userSession);
			});

			// // User requests for a canvas update
			// // input int: roomId
			// // input string: authToken
			// client.on("sync", function(msg){
			// 	this.log("Request for sync received");
			// });

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
							nsp.emit("canvas", {blob: buffer})
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