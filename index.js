
const realtime = require('socket.io')(3021);
const mysql = require('mysql');

const database = mysql.createConnection({
  host: "grunem.cp3p6vxyi67v.us-west-2.rds.amazonaws.com",
  user: "grunem_root",
  password: "grunem123",
  database: "geniuz"
});

const redis = require("redis");
const redisClient = redis.createClient({
  url: "redis://h:p3f517acbbb4b030df070a991212bd9258f80ffa702e9b08c4d79f61a24b69907@ec2-52-54-8-250.compute-1.amazonaws.com:9619",
});

redisClient.on("error", function (err) {
    console.log("Error redis" + err);
});

database.connect(function(err) {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }

  console.log('connected as id ' + database.threadId);
});

var isSessionMember = (username, session_id, callback) => {

  var query = 'SELECT * FROM geniuz.live_session_members ' +
              'WHERE session_id = "'+ session_id +'" '+
              'AND username = "'+ username +'" ' +
              'AND status = "active" ';
  try
  {
      database.query(query, function (err, results, fields) {

        if(err){
          return console.log(err)
        }

        if(results.length > 0){
          callback(true);
        }

        else {
          callback(false);
        }

      });

  }

  catch(error){
    console.log(error);
  }

}

var sendLastOperation = function(session_id, socket){

  var query = 'SELECT * FROM geniuz.live_operations ' +
              'WHERE session_id = "'+ session_id +'" ' +
              'ORDER BY id DESC LIMIT 1';

  try
  {
      database.query(query, function (err, results, fields) {

        if(err){
          return console.log(err)
        }

        if(results.length > 0){

          var data = { parity1: results[0].parity,
                        parity2: results[0].parity2,
                        market: results[0].market,
                        buyprice: results[0].operation_buy_price,
                        sellprice : results[0].operation_sell_price
                     };

          socket.emit('operation-update', {data: data})
        }

        else {
          callback(false);
        }

      });

  }

  catch(error){
    console.log(error);
  }

}

realtime.on('connection', (socket) => {

  socket.liveSession = null;
  socket.isAdmin = false;

  socket.on('isAdmin', () => {
    socket.isAdmin = true;
  });

  socket.on('chat-join', (data) => {

      var query = "SELECT * FROM live_session WHERE session_id = "+ database.escape(data.sessionName) +" AND session_status='active'";

      try
      {
        database.query(query, function (err, results, fields) {

            if (err){
              return console.log(err)
            }

            if(results.length >= 1){

              isSessionMember(data.username, data.sessionName, (status) => {

                if(status == false){
                  return socket.emit('error-message', {
                    message: "The username is not member"}
                  );
                }

                socket.liveSession = data.sessionName;
                socket.username = data.username;

                socket.join(data.sessionName);

                redisClient.get('messages-' + socket.liveSession, function(err, reply) {

                  if(reply != null){
                    sendLastOperation(socket.liveSession, socket);
                    socket.emit('render-chat', JSON.parse(reply));
                  }

                });

              })
            }

            else{

              socket.emit('error-message', {
                message: "The live session dont exist"
              });

            }
        });
      }

      catch(error){
        console.log(error);
      }


  });


  socket.on('get-live-operations', () => {

    if(socket.liveSession != null)
    {
      /*var query = 'INSERT INTO `geniuz`.`live_operations`' +
                  '(`session_id`, `parity`, `parity2`, `market`, `operation_buy_price`, `operation_sell_price`, `date`)' +
                  'VALUES ("rSHdb3ccT1aHorH", "BTC", "BCN", "Poloniex", "0.002", "0.003", "2018-20-33")';*/
    }

    else{
        return socket.emit('error-message', {
          message: "You dont have a session room"
         });
    }

  });

  socket.on('session-close', () => {

    realtime.to(socket.liveSession).emit('closed-session', {});

  });

  socket.on('update-operation', (data) => {

    if(socket.isAdmin != false){

      var query = 'INSERT INTO `geniuz`.`live_operations` ' +
                  '(`session_id`, `parity`, `parity2`, `market`, `operation_buy_price`, `operation_sell_price`, `date`) ' +
                  'VALUES ("'+ socket.liveSession +'", "'+data.parity1+'", "'+data.parity2+'", "'+data.market+'", "'+data.buyprice+'", "'+data.sellprice+'", "2018-20-33")';

      database.query(query, function (err, results, fields) {

        if (err){
          console.log(err)
        }

        realtime.to(socket.liveSession).emit('operation-update', {
          data: data
        });

      });

    }

  })

  socket.on('new-message-global', (message) => {

    if(socket.liveSession != null)
    {

      redisClient.get('messages-' + socket.liveSession, function(err, reply) {

          if(reply == null)
          {
              var json = {

                  messages: [{
                    username:socket.username,
                    text: message
                  }]
              };

              redisClient.set('messages-' + socket.liveSession, JSON.stringify(json));

              realtime.to(socket.liveSession).emit('new-message-emit', {
                username:socket.username,
                text: message
              });

          }

          else{

            redisClient.get('messages-' + socket.liveSession, function(err, reply) {

                var parsed = JSON.parse(reply);

                parsed.messages.push({
                  username:socket.username,
                  text: message
                });

                redisClient.set('messages-' + socket.liveSession, JSON.stringify(parsed));

                realtime.to(socket.liveSession).emit('new-message-emit', {
                  username:socket.username,
                  text: message
                });

            });

          }

          console.log(reply);
      });

    }

  });

});
