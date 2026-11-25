
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});await db.connect();
try {
 await db.query('BEGIN');
 const s=(await db.query('SELECT * FROM auth.household_login WHERE singleton FOR UPDATE')).rows[0];
 if(s.user_id) throw Error('Already configured; setup cannot be reopened.');
 const existing=(await db.query("SELECT id FROM auth.users WHERE email !~ '^qa-nas-[ab]-[0-9]+@example[.]test$'")).rows;
 if(existing.length===1) {
  await db.query('UPDATE auth.household_login SET user_id=$1,setup_until=NULL WHERE singleton',[existing[0].id]);
  console.log('Existing parent adopted. Use the same password; all records preserved.');
 } else if(existing.length) throw Error('Multiple existing accounts; administrator must choose the household owner.');
 else {
  await db.query("UPDATE auth.household_login SET setup_until=now()+interval '30 minutes' WHERE singleton");
  console.log('First-use setup is open for 30 minutes. Set your password on the website now.');
 }
 await db.query('COMMIT');
} catch(e) {await db.query('ROLLBACK');throw e;} finally {await db.end();}
