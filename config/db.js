const mysql = require('mysql2');
require("dotenv").config();

const connection = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
});

connection.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err.message);
    return;
  }
  console.log('✅ MySQL connected successfully');
});



module.exports =   connection ;


// require('dotenv').config();
// const express = require('express')
// const router = express.Router();
// const mysql  = require('mysql2')
//  const socketPath = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
// let db;

// if(socketPath != null){
//         db =  mysql.createConnection({
//         socketPath: socketPath,
//         user: process.env.DB_USER,
//         password: process.env.DB_PASSWORD,
//         database: process.env.DB_NAME
//         });
// }else{    
//     db = mysql.createConnection({
//             host     : 'localhost',
//             user     : 'root',
//             database : 'test_makaazi_db',
            
//         });

// }




// //Create a Connection to Database

// db.connect((err)=>{
//     if(err!=null){
//         console.log('No Connect to database')
        
//     }else{
//         console.log('Connect to database')
//     }
    
// })

// module.exports = db;