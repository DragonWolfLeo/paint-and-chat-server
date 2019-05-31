const Jimp = require("jimp");
const chalk = require('chalk');
const LinkedList = require('../util/LinkedList');

// Constants
const MESSAGE_TYPES = Object.freeze({
	USER_MESSAGE: "user_message",
	USER_JOIN: "user_join",
});

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
	};
}
class Room {
	constructor(id){
		this.id = id;
		// Initialize with a blank white canvas
		const width = 400, height = 400;
		this.canvas = new Jimp(width, height, 0xffffffff, (err, image) => {
			if(err){
				console.error(err);
				return;
			}
			image.opaque();
		});
	}
}

// Mock database structure
const mockLoginDatabase = {
	users: {
		user: {
			pass: "users_pass",
		},//User: object
		leo: {
			pass: "users_pass",
		},//User: object
		luka: {
			pass: "users_pass",
		},//User: object
		vada: {
			pass: "users_pass",
		},//User: object
	},//Array<User>: object[string:userLogin],
};

// User profiles; Non-sensitive user data goes here
const userProfiles = {
	user: new UserProfile("User", "#009900"),
	leo: new UserProfile("Dragon Wolf Leo", "#FF6600"),
	luka: new UserProfile("Luka Loginska", "#0051F3"),
	vada: new UserProfile("VAdaPEGA", "#FF0000"),
}

const activeRooms = {
	test_room: new Room("test_room"),
}

const activeUsers = new LinkedList();

function authenticate(userLogin, userPass, room, socket) {
	// Assert: That room exists
	if(!room){
		return {
			token: null,
			user: null,
			error: `Room ${roomId} does not exist on database`,
		};
	}
	// Assert: User/Password is correct
	const correctPass = 
		mockLoginDatabase.users[userLogin] !== null && 
		mockLoginDatabase.users[userLogin].pass === userPass;
	if(!correctPass)
		return {
			error: `Incorrect login/password for ${userLogin}`,
		};
	// Assign new token then return it
	const token = Math.random().toString(36).substring(7);

	activeUsers.append(new UserSession(socket, userProfiles[userLogin], room));
	

	const userProfile = userProfiles[userLogin];
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

function getAllSessionsOfRoom(room) {
	const sessions = [];
	let current = activeUsers.head;
	while(current){
		const userSession = current.value;
		if(room === userSession.room){
			sessions.push(userSession);
		}
		current = current.next;
	}
	return sessions;
}

function identifyUserSessionBySocket(socket) {
	let current = activeUsers.head;
	while(current){
		const userSession = current.value;
		if(socket === userSession.socket){
			return userSession;
		}
		current = current.next;
	}
	return null;
}

function broadcastMessageToRoom(io, room, message, userToExclude) {
	// Log message
	if(typeof(message) === "object"){
		if(message.type){
			switch(message.type){
				case MESSAGE_TYPES.USER_MESSAGE:
					const {user: {color, name}, message: str} = message;
					console.log(`[${room.id}] ${chalk.hex(color).bold(`${name} (${userToExclude})`)}: ${str}`);
					break;
				default: break;
			}
		}
	} else {
		console.log(`[${room.id}] ${message}`);
	}
	const connections = getAllSessionsOfRoom(room);
	connections.forEach(userSession => {
		if(userToExclude && userSession === userToExclude)
			return; // Don't send message back to the user who sent it when userToExclude is specified
		if(!io.sockets.connected[userSession.socket])
			return; // user must have disconnected or is not yet authenticated
		io.sockets.connected[userSession.socket].emit("sendMessage", message);
	});
}

function broadcastCanvasToRoom(io, room, data, userToExclude) {
	const connections = getAllSessionsOfRoom(room);
	connections.forEach(userSession => {
		if(userToExclude && userSession === userToExclude)
			return; // Don't send canvas back to the user who sent it when userToExclude is specified
		if(!io.sockets.connected[userSession.socket])
			return; // user must have disconnected or is not yet authenticated
		io.sockets.connected[userSession.socket].emit("sendCanvas", data);
	});
}

module.exports = function handleSocketUser(io) {
	io.on('connection', function(client){
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
		client.on("auth", function(jsonString){
			const authData = JSON.parse(jsonString);
			const room = activeRooms[authData.room];
			const authResponseJson = authenticate(authData.login, authData.pass, room, client.id);
			io.sockets.connected[client.id].emit("auth", JSON.stringify(authResponseJson));
			if(!authResponseJson.error) {
				const welcomeMessage = {
					type: MESSAGE_TYPES.USER_JOIN, 
					user: authResponseJson.user, 
					room: authData.room,
				};
				broadcastMessageToRoom(io, room, welcomeMessage);
				// Send current canvas to joined user
				room.canvas.getBufferAsync(Jimp.MIME_PNG)
				.then(buffer=>
					io.sockets.connected[client.id].emit("sendCanvas", {blob: buffer})
				)
				.catch(console.error);
			}
		});

		// User sends chat message
		// input string: message
		client.on("sendMessage", function(message){
			const userSession = identifyUserSessionBySocket(client.id);
			if(!userSession) {
				io.sockets.connected[client.id].emit("sendMessage", "You need to authenticate before sending messages.");
				return;
			}
			
			const m = {
				message,
				type: MESSAGE_TYPES.USER_MESSAGE,
				user: userSession.profile,
			}
			broadcastMessageToRoom(io, userSession.room, m, userSession);
		});

		// // User requests for a canvas update
		// // input int: roomId
		// // input string: authToken
		// client.on("sync", function(msg){
		// 	console.log("Request for sync received");
		// });

		// User sends a canvas update
		client.on("sendCanvas", function(data){
			const userSession = identifyUserSessionBySocket(client.id);
			if(!userSession) {
				io.sockets.connected[client.id].emit("sendMessage", "You need to authenticate before drawing.");
				return;
			}

			// Check if data exists
			if(!data.blob){ return console.log(`Invalid canvas data received from ${userSession.name}`);
			}

			// Read data
			Jimp.read(data.blob)
			.then(image => {
				const {room} = userSession;
				if(room.canvas){
					// Combine user drawing with main canvas
					const x = 0, y = 0;
					image.composite(room.canvas, x, y, {  
						mode: Jimp.BLEND_DESTINATION_OVER,
					})
					// Convert to buffer
					.getBufferAsync(Jimp.MIME_PNG)
					// Broadcast new canvas
					.then(buffer=>
						broadcastCanvasToRoom(io, room, {blob: buffer}, userSession)
					)
					.catch(console.error);
					room.canvas = image;
				}
				
			})
			.catch(err=>console.log(`Unable to read canvas data received from ${userSession.name}`,err));
			
		});

	});
}