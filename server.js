var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require("cors");
const dotenv = require('dotenv');
dotenv.config();

var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

const Room = require('./sockets/base');
const rooms = {};

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

const createRoom = () => {
	// Choose a random hash for the id
	let id;
	do {
		id = Math.random().toString(36).substring(7);
	} while (rooms[id]);
	const room = new Room(io, id, ()=>{
		console.log(`Room ${id} has been expired.`);
		delete rooms[id];
	});
	console.log(`Created room ${id}`);
	rooms[id] = room;
	return room;
}
const getNameAndColorFromBody = ({name, color}) =>{
	// Check if name and color is valid, and trim name
	return (name && color && typeof(name) === "string" && typeof(color) === "string") ?
		{name: name.trim().substring(0,20), color} : {};
};
// Requesting to create a room
app.post('/create', (req, res) => {
	const {name, color} = getNameAndColorFromBody(req.body);
	if(!name || !color){
		return res.status(400).json("There was an error.");
	}
	const room = createRoom();
	const token = room.generateUserToken(name, color);
	if(token){
		return res.json({room: room.id, token});
	}
	return res.status(400).json("There was an error");
});
// Requesting to join a room
app.post('/join/:room', (req, res) => {
	const {room: id} = req.params;
	const room = rooms[id];
	if(!room){
		return res.status(404).json({alert: "Room does not exist."});
	}
	const {name, color} = getNameAndColorFromBody(req.body);
	if(!name || !color){
		return res.status(400).json("There was an error.");
	}
	const token = room.generateUserToken(name, color);
	if(token){
		return res.json({room: room.id, token});
	}
	return res.status(400).json("There was an error");
});
// Check if room exists
app.get('/check/:room/:token?', (req, res) => {
	const {room: id, token} = req.params;
	const room = rooms[id];
	if(room){
		const authorized = token ? room.hasToken(token) : false;
		return res.json({authorized}) 
	}
	return res.status(404).json(false);
});

const port = process.env.PORT || 3001;
server.listen(port,()=>{
	console.log(`Listening on port ${port}`);
});
