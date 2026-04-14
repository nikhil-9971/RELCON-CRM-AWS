db = db.getSiblingDB("relconDB");
db.createUser({
  user: "relcon_user",
  pwd: "relcon2024",
  roles: [{ role: "readWrite", db: "relconDB" }],
});
print("✅ relconDB user created");
