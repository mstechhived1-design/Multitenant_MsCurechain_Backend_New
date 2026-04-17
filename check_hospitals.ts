import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();
async function check() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://admin:curechain_admin@curechain.uimxxl9.mongodb.net/curechain?appName=Curechain');
  const Hospital = mongoose.model('Hospital', new mongoose.Schema({}, {strict: false}), 'hospitals');
  const h = await Hospital.find({}, { name: 1, status: 1 }).lean();
  console.log('Hospitals:', h.length, h);
  process.exit(0);
}
check();
