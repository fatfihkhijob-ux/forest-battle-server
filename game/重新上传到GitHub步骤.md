# 清空 GitHub 后重新上传（一步步照做）

## 第一部分：在 GitHub 上删掉现有文件

1. 打开：https://github.com/fatfihkhijob-ux/forest-battle-server  
2. 登录你的 GitHub 账号。

### 先删 game 里面的文件（从最里层开始）

3. 点进 **game** 文件夹 → 再点进 **static** 文件夹。  
4. 在 static 里，**逐个**点下面这些文件，每点一个就：
   - 点文件里的 **垃圾桶图标** 或 **Delete this file**
   - 页面底部点 **Commit changes**（说明可填「删除」）
   - 删完一个再删下一个  
   要删的 static 里的文件：
   - game-main.js  
   - kids.js  
   - kids.css  
   - achievements.css  
   - Gemini_Generated_Image_z0zoovz0zoovz0zo.png  
   - unnamed (1).jpg  
   - unnamed (2).jpg  
   - unnamed.jpg  

5. 回到 **game** 文件夹（不要进 static 了）。  
6. 在 game 里继续**逐个删除**：
   - forest.html  
   - index.html  
   - game.js  
   - app.py  
   - config.py  
   - init_db.py  
   - 要点.md  
   - 初始化数据库.bat  
   （如有 data 文件夹，点进去删掉里面的 users.json，再回 game 删 data 里能删的。）

7. 点进 **game** → **templates**，删掉里面三个文件：
   - achievements.html  
   - kids.html  
   - parent.html  

8. 回到仓库**首页**（点最上面仓库名 forest-battle-server）。  
9. 在根目录删掉：
   - server.js  
   - package.json  
   - requirements.txt  

删完后，仓库里应该是空的（或只剩一个 README，可保留或删掉都行）。

---

## 第二部分：按顺序重新上传（一个传完再传下一个）

上传时：点 **Add file** → **Upload files**，把本地的文件**拖进去**，在文件名框里**改成下面写的路径**，再点 **Commit changes**。

你的本地文件夹是：`桌面\新建文件夹 (2)\`  
下面说的「根目录」= 和 game 同一层的那几个文件。

| 顺序 | 本地文件 | 上传到 GitHub 时的路径（填在文件名框里） |
|------|----------|----------------------------------------|
| 1 | 根目录的 server.js | `server.js` |
| 2 | 根目录的 package.json | `package.json` |
| 3 | 根目录的 requirements.txt | `requirements.txt` |
| 4 | game 里的 forest.html | `game/forest.html` |
| 5 | game 里的 index.html | `game/index.html` |
| 6 | game 里的 game.js | `game/game.js` |
| 7 | game 里的 app.py | `game/app.py` |
| 8 | game 里的 config.py | `game/config.py` |
| 9 | game 里的 init_db.py | `game/init_db.py` |
| 10 | game/static 里的 game-main.js | `game/static/game-main.js` |
| 11 | game/static 里的 kids.css | `game/static/kids.css` |
| 12 | game/static 里的 kids.js | `game/static/kids.js` |
| 13 | game/static 里的 achievements.css | `game/static/achievements.css` |
| 14 | game/static 里的 Gemini_Generated_Image_z0zoovz0zoovz0zo.png | `game/static/Gemini_Generated_Image_z0zoovz0zoovz0zo.png` |
| 15 | game/static 里的 unnamed (1).jpg | `game/static/unnamed (1).jpg` |
| 16 | game/static 里的 unnamed (2).jpg | `game/static/unnamed (2).jpg` |
| 17 | game/static 里的 unnamed.jpg | `game/static/unnamed.jpg` |
| 18 | game/templates 里的 achievements.html | `game/templates/achievements.html` |
| 19 | game/templates 里的 kids.html | `game/templates/kids.html` |
| 20 | game/templates 里的 parent.html | `game/templates/parent.html` |

### 上传时注意

- 每次上传一个文件（或同一路径下的几个），**文件名框**里要填表里对应的路径（例如 `game/forest.html`），这样才会出现 game 文件夹、static 文件夹等。  
- 传完一个就点一次 **Commit changes**，再传下一个。  
- 若一次拖了多个文件，在列表里**逐个**把「Name」改成表里的路径再提交。

---

## 第三部分：传完后在 Render 部署

1. 打开 Render：https://dashboard.render.com  
2. 进入 **forest-battle-server** 服务。  
3. 点 **Manual Deploy** → **Deploy latest commit**。  
4. 等状态变成绿色 **Live**。  
5. 再打开 **forest-backend** 服务，同样 **Manual Deploy** 一次（如果之前改过 Python 代码）。

然后浏览器打开：https://forest-battle-server.onrender.com ，按 **Ctrl+F5** 强制刷新，再试注册/登录。这时应显示「森林服务器正在醒来…」而不是英文 NetworkError。
