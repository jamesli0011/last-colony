var unmarshal_msg = function(array) {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while(i < len) {
        c = array[i++];
        switch(c >> 4) { 
              case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
                // 0xxxxxxx
                out += String.fromCharCode(c);
                break;
              case 12: case 13:
                // 110x xxxx   10xx xxxx
                char2 = array[i++];
                out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
                break;
              case 14:
                // 1110 xxxx  10xx xxxx  10xx xxxx
                char2 = array[i++];
                char3 = array[i++];
                out += String.fromCharCode(((c & 0x0F) << 12) |
                               ((char2 & 0x3F) << 6) |
                               ((char3 & 0x3F) << 0));
                break;
        }
    }

    return JSON.parse(out);
};

var marshal_msg = function(str) {
    var utf8 = new Uint8Array(4 + str.length*4);
    var utf8Index = 4;

    for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) {
            // utf8.push(charcode);
            utf8[utf8Index++] = charcode;
        } else if (charcode < 0x800) {

            utf8[utf8Index++] = 0xc0 | (charcode >> 6);
            utf8[utf8Index++] = 0x80 | (charcode & 0x3f);
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {

            utf8[utf8Index++] = 0xe0 | (charcode >> 12);
            utf8[utf8Index++] = 0x80 | ((charcode>>6) & 0x3f);
            utf8[utf8Index++] = 0x80 | (charcode & 0x3f);
        }
        // surrogate pair
        else {
            i++;
            // UTF-16 encodes 0x10000-0x10FFFF by
            // subtracting 0x10000 and splitting the
            // 20 bits of 0x0-0xFFFFF into two halves
            charcode = 0x10000 + (((charcode & 0x3ff)<<10)
                      | (str.charCodeAt(i) & 0x3ff))

            utf8[utf8Index++] = 0xf0 | (charcode >>18);
            utf8[utf8Index++] = 0x80 | ((charcode>>12) & 0x3f);
            utf8[utf8Index++] = 0x80 | ((charcode>>6) & 0x3f);
            utf8[utf8Index++] = 0x80 | (charcode & 0x3f);
        }
    }

    var msgLength = utf8Index - 4;
    utf8[0] = msgLength >> 24;
    utf8[1] = 0xff & (msgLength >> 16);
    utf8[2] = 0xff & (msgLength >> 8);
    utf8[3] = 0xff & msgLength;

    return utf8.subarray(0, utf8Index);
};

var gamedata = {};

var netclient = {
	websocket:null,
	buf: new Uint8Array(),
	packets: new Array(),
	state:"login",

	connect:function(addr) {
		var loginname = $("#loginname").val();
		loginname = loginname.trim();
		if (loginname == "") {
			console.log("loginname is empty");
			return;
		}

		var WebSocketObject = window.WebSocket || window.MozWebSocket;
		if (!WebSocketObject) {
			game.showMessageBox("Your browser does not support WebSocket. Multiplayer will not work.");
			return;
		}

		console.log("connect to " + addr);

		this.websocket = new WebSocketObject(addr);
		this.websocket.binaryType = 'arraybuffer';
		this.websocket.onmessage = netclient.onmessage;
		this.websocket.onopen = function() {
			console.log("onopen, state: " + netclient.state);
			if (netclient.state == "login") {
				netclient.send_login_req(loginname);
			} else if (netclient.state == "logic") {
				netclient.send_game_login_req();
			}
		};

		this.websocket.onerror = function() {
			netclient.reset();
		};

		this.websocket.onclose = function() {
			netclient.reset();
		};
	},

	close:function(){
		if (this.websocket != undefined) {
			this.websocket.close();
		}
		this.reset();
	},

	reset:function() {
		this.buf = new Uint8Array();
		this.packets = new Array();
	},

	onmessage:function(e) {
		netclient.recv_msg(new Uint8Array(e.data));
	},

	sendmessage:function(msg) {
    // console.log(">>");
    // console.log(msg);
    var bytes = marshal_msg(JSON.stringify(msg));
    this.websocket.send(bytes);
	},

	recv_msg:function(msg) {
        if (msg.length > 0) {
            var newbuf = new Uint8Array(netclient.buf.length + msg.length);
            newbuf.set(netclient.buf, 0);
            newbuf.set(msg, netclient.buf.length);
            netclient.buf = newbuf;
        }

        var i = 0;
        while(true) {
            if (netclient.buf.length - i >= 4) {
                var msgLength = (netclient.buf[i]<<24) + (netclient.buf[i+1] <<16) + (netclient.buf[i+2]<<8) + netclient.buf[i+3];
                if (msg.length >= (i + 4 + msgLength)) {
                    var bytes = netclient.buf.subarray(i+4, i+4+msgLength);
                    var packet = unmarshal_msg(bytes);
                    // console.log("<< " + netclient.addr + " received packet");
                    // console.log(packet);
                    netclient.packets.push(packet);
                    i += 4 + msg.length;
                }
            } else {
                break;
            }
        }

        if (i > 0) {
            netclient.buf = netclient.buf.subarray(i, netclient.buf.length);
        }

        if (netclient.packets.length > 0) {
        	var packets = netclient.packets;
        	netclient.packets = new Array();
        	for (var i = 0; i < packets.length; i++) {
        		netclient.handle_packet(packets[i]);
        	}
        }
	},

	send_login_req:function(loginname) {
		gamedata.account_name = loginname;
		var msg = {
			msgId:"LOGIN_REQ",
			loginReq:{
				platform:"debug",
				platformUid:loginname,
			},
		};
		this.sendmessage(msg);
	},

	handle_packet:function(packet) {
		if (packet.cmdResult != "SUCCESS") {
			console.log(packet.msgId + ", " + packet.cmdResult);
			return;
		}

		if (packet.msgId == "LOGIN_RSP") {
			this.handle_login_rsp(packet);
		} else if (packet.msgId == "GAME_LOGIN_RSP") {
			this.handle_game_login_rsp(packet);
		} else if (packet.msgId == "GAME_CREATE_PLAYER_RSP") {
			this.handle_create_char_rsp(packet);
		} else if (packet.msgId == "GAME_ENTER_WORLD_RSP") {
			this.handle_enter_world_rsp(packet);
		} else if (packet.msgId == "COLONY_LATENCY_PING") {
      netclient.send_latency_pong();
    } else if (packet.msgId == "COLONY_ROOM_LIST_RSP") {
      multiplayer.updateRoomStatus(packet.colonyRoomList.status);
    } else if (packet.msgId == "COLONY_JOIN_ROOM_RSP") {
      // packet.colonyJoinRoomRsp
      console.log("joined_room");
      console.log(packet.colonyJoinRoomRsp);
      multiplayer.roomId = packet.colonyJoinRoomRsp.roomId;
      multiplayer.color = packet.colonyJoinRoomRsp.color;
    } else if (packet.msgId == "COLONY_CMD_TICK") {
      // packet.colonyCmdTick
      multiplayer.lastReceivedTick = packet.colonyCmdTick.tick;

      var newcommands = [];
      for (k in packet.colonyCmdTick.commands) {
        var oldcommand = packet.colonyCmdTick.commands[k];
        var newcommand = {};

        if (oldcommand.uids != undefined && oldcommand.details != undefined) {
          newcommand.uids = JSON.parse(oldcommand.uids);
          newcommand.details = JSON.parse(oldcommand.details);
        } else {
          newcommand.uids = [];
          newcommand.details = [];
        }
        
        newcommands.push(newcommand);
      }

      multiplayer.commands[packet.colonyCmdTick.tick] = newcommands;
    } else if (packet.msgId == "COLONY_CMD_INIT_LEV_NOITFY") {
      console.log("init_lev");
      console.log(packet.colonyInitLevNotify);
      if (packet.colonyInitLevNotify.level == undefined) {
        packet.colonyInitLevNotify.level = 0;
      }
      multiplayer.initMultiplayerLevel(packet.colonyInitLevNotify);
    } else if (packet.msgId == "COLONY_CMD_END_GAME") {
      console.log("end_game");
      multiplayer.endGame(packet.colonyCmdEndGameRsp.reason);
    } else if (packet.msgId == "COLONY_CMD_CHAT_MSG") {
      game.showMessage(packet.colonyCmdChatRsp.from, packet.colonyCmdChatRsp.msg);
    } else if (packet.msgId == "COLONY_CMD_START_GAME") {
      console.log("start_game");
      multiplayer.startGame();
    }
	},

	handle_login_rsp:function(packet) {
		gamedata.account = packet.loginRsp.account;
		gamedata.serverList = packet.loginRsp.serverList;

		var gate = gamedata.serverList[0];

		netclient.close();
		netclient.state = "logic";
		netclient.connect(gate.serverRelayAddr);
	},

	handle_game_login_rsp:function(packet) {
		if (packet.gameloginRsp.players == undefined || packet.gameloginRsp.players == null) {
			$('.gamelayer').hide();
			$('#createchar').show();
			return;
		}

		if (packet.gameloginRsp.players.length == 0) {
			$('.gamelayer').hide();
			$('#createchar').show();
			return;
		}

		var player = packet.gameloginRsp.players[0];
		gamedata.player = player;

		netclient.send_enter_world_req();
	},

	start_match:function() {
		$(".gamelayer").hide();
    $("#multiplayerlobbyscreen").show();

    var msg = {
    	msgId : "COLONY_MATCH",
    };

    netclient.sendmessage(msg);
	},

  enter_game:function(player) {
    // var roles = player.roleData.roles;
    // roles.sort(function(o1, o2){
    //   return o1.id - o2.id;
    // });
    gamedata.player = player;
    netclient.start_match();
  },

	handle_create_char_rsp:function(packet) {
		var player = packet.createPlayerRsp.player;
    netclient.enter_game(player);
	},

	handle_enter_world_rsp:function(packet) {
		var player = packet.enterWorldRsp.player;
    netclient.enter_game(player);
	},

	send_game_login_req:function() {
		var msg = {
			msgId : "GAME_LOGIN_REQ",
			gameloginReq : {
				accountId : gamedata.account.accountId,
				token : gamedata.account.token,
			},
		};
		netclient.sendmessage(msg);
	},

	send_enter_world_req:function() {
		var msg = {
			msgId : "GAME_ENTER_WORLD_REQ",
			gameEnterReq : {
				playerId : gamedata.player.id,
			},
		};
		netclient.sendmessage(msg);
	},

	create_player: function() {
		var charname = $("#charname").val();
		charname = charname.trim();
		if (charname == "") {
			game.showMessageBox("Please input character name");
			return;
		}

		console.log("create player : " + charname);

		gamedata.charname = charname;
		var msg = {
			msgId : "GAME_CREATE_PLAYER_REQ",
			createPlayerReq : {
				playerName : charname,
			},
		};
		netclient.sendmessage(msg);
	},

  send_match: function() {
    var msg = {
      msgId : "COLONY_MATCH",
    };
    netclient.sendmessage(msg);
  },

  send_latency_pong: function() {
    var msg = {
      msgId : "COLONY_LATENCY_PONG",
    };
    netclient.sendmessage(msg);
  },

  send_join_room:function(roomId) {
    var msg = {
      msgId : "COLONY_JOIN_ROOM_REQ",
      colonyJoinRoom:{
        roomId:roomId,
      },
    };
    netclient.sendmessage(msg);
  },

  send_leave_room:function() {
    var msg = {
      msgId : "COLONY_LEAVE_ROOM_REQ",
    };
    netclient.sendmessage(msg);
  },

  send_init_lev_ready:function() {
    console.log("init_lev_ready");
    var msg = {
      msgId : "COLONY_CMD_INIT_LEV_READY",
    };
    netclient.sendmessage(msg);
  },

  send_cmd_command:function(tick, uids, details) {
    multiplayer.sentCommandForTick = true;

    var msg = {
      msgId : "COLONY_CMD_COMMAND_REQ",
      colonyCmdCommandReq: {
        tick : tick,
        command : {
          uids : JSON.stringify(uids),
          details : JSON.stringify(details),
        },
      },
    };
    netclient.sendmessage(msg);
  },

  send_cmd_lose_game:function() {
    var msg = {
      msgId:"COLONY_CMD_LOSE_GAME_REQ",
    };
    console.log("lose game");
    netclient.sendmessage(msg);
  },

  send_cmd_chat:function(chatmsg) {
    var msg = {
      msgId : "COLONY_CMD_CHAT_REQ",
      colonyCmdChatReq: {
        msg : chatmsg,
      },
    };
    netclient.sendmessage(msg);
  },

};