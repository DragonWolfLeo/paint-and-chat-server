const Jimp = require("jimp");

// Mock database structure
let mockJsonDatabase = {
	users: {
		"user": {
			name: "User",
			pass: "users_pass",
		},
		"leo": {
			name: "Dragon Wolf Leo",
			pass: "users_pass",
		},//User: object
		"luka": {
			name: "Luka Loginska",
			pass: "users_pass",
		},//User: object
		"vada": {
			name: "VAdaPEGA",
			pass: "users_pass",
		},//User: object
	},//Array<User>: object[string:userLogin],

	rooms: {
		"dargon_drawing_room": {
			// canvas: { // array[int:x][int:y] e.g. canvas[5][10] is the pixel at 5,10
			// 	"5": {
			// 		"10": {
			// 			rgbaHexColor: "#ff0000ff",
			// 		},//Pixel: object
			// 	},//Column: object[int]:y
			// },//Canvas: object[int:x][int:y]
			canvas: null, // Jimp instance
		},//Room
	},//Array<Room>: object[string:roomId],

};

let active_connections = {
	"userLoginExample": {
		"roomExample": {
			"token": null, // string
			"socket": null, // WebSocket
		}
	},
};

function authenticate(userLogin, userPass, roomId, socket) {
	// Assert: That room exists
	if(mockJsonDatabase.rooms[roomId] == null)
		return {
			token: null,
			user: null,
			error: "Room "+roomId+" does not exist on database",
		};
	// Assert: User/Password is correct
	var correctPass = mockJsonDatabase.users[userLogin] != null && mockJsonDatabase.users[userLogin].pass == userPass;
	if(!correctPass)
		return {
			token: null,
			user: null,
			error: "Incorrect login/password for "+userLogin,
		};
	// Assign new token then return it
	if(!active_connections[userLogin]) active_connections[userLogin] = {};
	active_connections[userLogin][roomId] = {
		token: Math.random().toString(36).substring(7),
		socket: socket,
	};
	return {
		token: active_connections[userLogin][roomId].token,
		user: mockJsonDatabase.users[userLogin],
		error: null,
	};
}

function getAllSocketsOfRoomId(roomId) {
	var sockets = [];
	for(var userLogin in active_connections) {
		for(var _roomId in active_connections[userLogin]) {
			if(_roomId != roomId)
				continue;
			if(active_connections[userLogin] == null || active_connections[userLogin][_roomId] == null || active_connections[userLogin][_roomId].socket == null)
				continue;
			sockets.push({
				userLogin: userLogin,
				socket: active_connections[userLogin][_roomId].socket,
			});
		}
	}
	return sockets;
}

function getUserByLogin(userLogin) {
	if(mockJsonDatabase.users) {
		return mockJsonDatabase.users[userLogin];
	}
}

function getRoomById(roomId) {
	return mockJsonDatabase.rooms[roomId];
}

function identifyUserContextBySocket(socket) {
	for(var userLogin in active_connections) {
		for(var roomId in active_connections[userLogin]) {
			if(active_connections[userLogin][roomId] == null || active_connections[userLogin][roomId] == null )
				continue;
			if(active_connections[userLogin][roomId].socket == socket)
				return {
					userLogin: userLogin,
					user: getUserByLogin(userLogin),
					room: roomId,
				};
		}
	}
	return null;
}

function broadcastMessageToRoom(io, roomId, message, userLoginToExclude) {
	console.log("Broadcasting message to room "+roomId+": "+message);
	var connections = getAllSocketsOfRoomId(roomId);
	connections.forEach(conn => {
		if(userLoginToExclude && conn.userLogin == userLoginToExclude)
			return; // Don't send message back to the user who sent it when userLoginToExclude is specified
		if(!io.sockets.connected[conn.socket])
			return; // user must have disconnected or is not yet authenticated
		io.sockets.connected[conn.socket].emit("sendMessage", message);
	});
}

function broadcastCanvasToRoom(io, roomId, data, userLoginToExclude) {
	console.log(`Broadcasting canvas to room ${roomId}`);
	const connections = getAllSocketsOfRoomId(roomId);
	connections.forEach(conn => {
		// if(userLoginToExclude && conn.userLogin === userLoginToExclude)
		// 	return; // Don't send canvas back to the user who sent it when userLoginToExclude is specified
		if(!io.sockets.connected[conn.socket])
			return; // user must have disconnected or is not yet authenticated
		io.sockets.connected[conn.socket].emit("sendCanvas", data);
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
				var authData = JSON.parse(jsonString);
				var authResponseJson = authenticate(authData.login, authData.pass, authData.room, client.id);
				io.sockets.connected[client.id].emit("auth", JSON.stringify(authResponseJson));
				if(!authResponseJson.error) {
					var welcomeMessage = `${authResponseJson.user.name} has joined the Room ${authData.room}`;
					broadcastMessageToRoom(io, authData.room, welcomeMessage);
					// Send current canvas to joined user
					const room = getRoomById(authData.room);
					if(room.canvas){
						room.canvas.getBufferAsync(Jimp.MIME_PNG)
						.then(buffer=>
							io.sockets.connected[client.id].emit("sendCanvas", {blob: buffer})
						)
						.catch(console.error);
					}
				}
			});

			// User sends chat message
			// input string: message
			client.on("sendMessage", function(message){
				const userContext = identifyUserContextBySocket(client.id);
				if(!userContext) {
					io.sockets.connected[client.id].emit("sendMessage", "You need to authenticate before sending messages.");
					return;
				}
					
				// var connections = getAllSocketsOfRoomId(userContext.roomId);
				// console.log("Received request to send message by user "+userContext.userLogin+" in roomId "+userContext.room);
				// console.log("connections are: ", connections);
				
				var now = new Date();
				message = now.toLocaleDateString()+" "+now.toLocaleTimeString()+" "+userContext.user.name+": "+message;
				broadcastMessageToRoom(io, userContext.room, message, userContext.userLogin);
			});

			// User requests for a canvas update
			// input int: roomId
			// input string: authToken
			client.on("sync", function(msg){
				console.log("Request for sync received");
			});

			// User sends a canvas update
			client.on("sendCanvas", function(data){
				const userContext = identifyUserContextBySocket(client.id);
				if(!userContext) {
					io.sockets.connected[client.id].emit("sendMessage", "You need to authenticate before drawing.");
					return;
				}

				// Check if data exists
				if(!data.blob){ return console.log(`Invalid canvas data received from ${userContext.user.name}`);
				}

				// Read data
				Jimp.read(data.blob)
				.then(image => {
					const room = getRoomById(userContext.room);
					if(!room.canvas){
						// Canvas doesn't exist. Initialize with a blank white canvas
						const width = 400, height = 400;
						room.canvas = new Jimp(width, height, 0xffffffff, (err, image) => {
							if(err){
								console.error(err);
								return;
							}
							image.opaque();
						});
					}
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
							broadcastCanvasToRoom(io, userContext.room, {blob: buffer})
						)
						.catch(console.error);
						room.canvas = image;
					}
					
				})
				.catch(err=>console.log(`Unable to read canvas data received from ${userContext.user.name}`,err));
				
			});

		});
}