import { useEffect, useState } from 'react';
import { useStore } from '../store';
import Modal from '../components/Modal';

export default function ResumeManagement() {
  const { resumes, loadingResumes, loadResumes, addResume, editResume, removeResume } = useStore();
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addSkills, setAddSkills] = useState('');
  const [addExperience, setAddExperience] = useState('');

  useEffect(() => { loadResumes(); }, []);

  const handleAdd = async () => {
    if (!addName.trim()) return alert('请输入简历名称');
    await addResume({
      name: addName,
      content: {
        name: '张三',
        title: addTitle || '前端开发工程师',
        skills: addSkills ? addSkills.split(/[,，]/).map(s => s.trim()) : ['React', 'TypeScript'],
        experience: addExperience || '3年',
      },
    });
    setShowAdd(false);
    setAddName('');
    setAddTitle('');
    setAddSkills('');
    setAddExperience('');
  };

  const handleSetDefault = async (resume: typeof resumes[0]) => {
    if (resume.is_default) return;
    await editResume(resume.id, { isDefault: true });
  };

  const handleDelete = async (id: string, name: string) => {
    if (window.confirm(`确定要删除 "${name}" 吗？`)) {
      await removeResume(id);
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#2C3E50]">简历管理</h1>
        <p className="text-sm text-[#7F8C8D] mt-2">上传和管理您的简历版本</p>
      </div>

      {loadingResumes ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-6 h-[220px] skeleton" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {resumes.map((r) => {
            let content: { title?: string; skills?: string[]; experience?: string } = {};
            try { content = JSON.parse(r.content || '{}'); } catch {}
            return (
              <div key={r.id} className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 relative">
                <div className="h-[120px] bg-gradient-to-br from-[#F5F7FA] to-[#E8EDF2] rounded-lg mb-4 flex items-center justify-center text-5xl text-[#7F8C8D]">
                  📄
                </div>
                <h3 className="text-base font-semibold mb-2">{r.name}</h3>
                <div className="text-sm text-[#7F8C8D] mb-4">
                  创建时间：{r.created_at?.split(' ')[0]}
                  {r.is_default ? <span className="text-accent ml-2">★ 默认</span> : null}
                </div>
                {content.title && (
                  <div className="text-sm text-[#7F8C8D] mb-1">
                    意向：{content.title} | {content.experience}
                  </div>
                )}
                {content.skills && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {content.skills.map((s) => (
                      <span key={s} className="text-xs bg-[#F5F7FA] text-[#2C3E50] px-2 py-0.5 rounded">{s}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 text-sm rounded-lg border border-[#E1E8ED] hover:border-primary hover:text-primary transition-colors"
                  >
                    预览
                  </button>
                  {!r.is_default && (
                    <button
                      onClick={() => handleSetDefault(r)}
                      className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-[#FF8C5A] transition-colors"
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(r.id, r.name)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-[#E1E8ED] text-[#E74C3C] hover:bg-[#E74C3C]/10 transition-colors ml-auto"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setShowAdd(true)}
        className="mt-5 px-5 py-2.5 bg-accent text-white rounded-lg hover:bg-[#FF8C5A] transition-colors font-medium"
      >
        + 添加新简历
      </button>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="添加新简历"
        footer={
          <>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 rounded-lg border border-[#E1E8ED] hover:border-primary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              className="px-4 py-2 rounded-lg bg-accent text-white hover:bg-[#FF8C5A] transition-colors"
            >
              添加
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">简历名称 *</label>
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="例如：前端开发简历-标准版"
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">意向岗位</label>
            <input
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              placeholder="例如：高级前端开发工程师"
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">技能标签（逗号分隔）</label>
            <input
              value={addSkills}
              onChange={(e) => setAddSkills(e.target.value)}
              placeholder="例如：React, TypeScript, Node.js"
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">工作经验</label>
            <input
              value={addExperience}
              onChange={(e) => setAddExperience(e.target.value)}
              placeholder="例如：5年"
              className="w-full px-4 py-3 border border-[#E1E8ED] rounded-lg bg-[#F5F7FA] focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
