const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://mstechhive2_db_user:3ynXXiwJQeoIaqZP@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain';

async function check() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected');
  
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }), 'users');
  
  const allWithRamuMobile = await User.find({ mobile: '9199999999' });
  console.log('--- USERS WITH MOBILE 9199999999 ---');
  console.log(JSON.stringify(allWithRamuMobile.map(u => ({ id: u._id, name: u.name, role: u.role })), null, 2));

  const allWithManiMobile = await User.find({ mobile: '6546546544' });
  console.log('--- USERS WITH MOBILE 6546546544 ---');
  console.log(JSON.stringify(allWithManiMobile.map(u => ({ id: u._id, name: u.name, role: u.role })), null, 2));

  await mongoose.disconnect();
}

check().catch(console.error);
