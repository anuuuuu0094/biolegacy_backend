const asyncHandler = require("../../utils/asyncHandler");
const { success } = require("../../utils/apiResponse");
const authService = require("./auth.service");

function preventCaching(res) {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
}

const providers = asyncHandler(async (req, res) => {
  void req;
  success(res, authService.getProviderSettings(), "Sign-in providers fetched");
});

const login = asyncHandler(async (req, res) => {
  preventCaching(res);
  const data = await authService.login(req.body);
  success(res, data, "Login successful");
});

const adminLogin = asyncHandler(async (req, res) => {
  preventCaching(res);
  const data = await authService.adminLogin(req.body);
  success(res, data, "Administrator login successful");
});

const refresh = asyncHandler(async (req, res) => {
  preventCaching(res);
  const data = await authService.refresh(req.body.refreshToken);
  success(res, data, "Token refreshed");
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  success(res, null, "Logged out");
});

const me = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.sub);
  success(res, user, "Current user");
});

const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.sub, req.body);
  success(res, user, "Profile updated");
});

const updatePassword = asyncHandler(async (req, res) => {
  await authService.updatePassword(req.user.sub, req.body);
  success(res, { signedOut: true }, "Password updated. Please sign in again.");
});

const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.sub);
  success(res, null, "Signed out on all devices");
});

const createUser = asyncHandler(async (req, res) => {
  const user = await authService.createUser(req.body);
  success(res, user, "User created", 201);
});

const googleLogin = asyncHandler(async (req, res) => {
  preventCaching(res);
  const data = await authService.loginWithIdentity("google", req.body);
  success(res, data, "Google sign-in successful");
});

const appleLogin = asyncHandler(async (req, res) => {
  preventCaching(res);
  const data = await authService.loginWithIdentity("apple", req.body);
  success(res, data, "Apple sign-in successful");
});

const sendPhoneCode = asyncHandler(async (req, res) => {
  success(res, await authService.sendPhoneCode(req.body.phone), "Verification code sent");
});

const checkPhoneCode = asyncHandler(async (req, res) => {
  preventCaching(res);
  success(res, await authService.checkPhoneCode(req.body), "Phone verified and signed in");
});

module.exports = {
  providers, login, adminLogin, refresh, logout, me, updateMe, updatePassword, logoutAll,
  createUser, googleLogin, appleLogin, sendPhoneCode, checkPhoneCode,
};
