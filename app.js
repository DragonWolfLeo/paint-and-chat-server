var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require("cors");

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);

const Room = require('./sockets/base');
const rooms = {room1: new Room(io, "room1")};

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// app.use('/', indexRouter);
// app.use('/users', usersRouter);

const createRoom = () => {
	// Choose a random hash for the id
	let id;
	do {
		id = Math.random().toString(36).substring(7);
	} while (rooms[id]);
	const room = new Room(io, id);
	console.log(`Created room ${id}`);
	rooms[id] = room;
	return room;
}
app.post('/create', (req, res) => {
	// TODO: Make rooms expire when unused
	const {name, color} = req.body;
	if(!name || !color){
		return res.status(400).json("There was an error.");
	}
	const room = createRoom();
	const token = room.generateUserToken(name, color);
	if(token){
		res.json({room: room.id, token});
	} else {
		res.status(400).json("There was an error");
	}
});
app.post('/join/:room', (req, res) => {
	const {room: id} = req.params;
	const room = rooms[id];
	const {name, color} = req.body;
	if(!room || !name || !color){
		return res.status(400).json("There was an error.");
	}
	const token = room.generateUserToken(name, color);
	if(token){
		res.json({room: room.id, token});
	} else {
		res.status(400).json("There was an error");
	}
});


const port = process.env.PORT || 3001;
server.listen(port,()=>{
	console.log(`Listening on port ${port}`);
});
