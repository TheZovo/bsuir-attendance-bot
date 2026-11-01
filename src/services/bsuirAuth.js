import { config } from '../config.js';

/**
 * Authenticate with IIS BSUIR using user's student credentials
 * Fetches personal profile, group info, and the real student group roster
 */
export async function loginToIis(username, password) {
  try {
    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    const res = await fetch(`${config.bsuirApiBase}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify({
        username: cleanUsername,
        password: cleanPassword,
        rememberDevice: false
      })
    });

    if (res.status === 401 || res.status === 400) {
      return { success: false, error: 'Неверный логин или пароль от ИИС БГУИР' };
    }

    if (!res.ok) {
      return { success: false, error: `Ошибка ИИС (HTTP ${res.status})` };
    }

    // Extract cookies from login response (Spring SESSION)
    const setCookieHeaders = res.headers.getSetCookie 
      ? res.headers.getSetCookie() 
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);

    const cookiePairs = setCookieHeaders
      .map(c => c.split(';')[0].trim())
      .filter(Boolean);
    const cookieHeader = cookiePairs.join('; ');

    const loginData = await res.json().catch(() => ({}));
    console.log('[BSUIR Auth] Login success for user:', cleanUsername, 'Cookies:', cookiePairs.length);

    let profileData = {};
    let groupData = {};
    let headmanStudents = [];

    const authHeaders = {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
    };

    // 1. Fetch personal profile
    try {
      const profRes = await fetch(`${config.bsuirApiBase}/profiles/personal-profile`, {
        headers: authHeaders
      });
      if (profRes.ok) {
        profileData = await profRes.json().catch(() => ({}));
        console.log('[BSUIR Auth] Retrieved personal-profile successfully');
      } else {
        console.warn(`[BSUIR Auth] /profiles/personal-profile returned status ${profRes.status}`);
      }
    } catch (e) {
      console.warn('[BSUIR Auth] Error calling /profiles/personal-profile:', e.message);
    }

    // 2. Fetch user group info
    try {
      const grpRes = await fetch(`${config.bsuirApiBase}/student-groups/user-group-info`, {
        headers: authHeaders
      });
      if (grpRes.ok) {
        groupData = await grpRes.json().catch(() => ({}));
        console.log('[BSUIR Auth] Retrieved user-group-info successfully');
      } else {
        console.warn(`[BSUIR Auth] /student-groups/user-group-info returned status ${grpRes.status}`);
      }
    } catch (e) {
      console.warn('[BSUIR Auth] Error calling /student-groups/user-group-info:', e.message);
    }

    // 3. Fetch headman group students if accessible
    try {
      const hRes = await fetch(`${config.bsuirApiBase}/headman/students`, {
        headers: authHeaders
      });
      if (hRes.ok) {
        const hData = await hRes.json().catch(() => []);
        console.log('[BSUIR Auth] /headman/students response count:', Array.isArray(hData) ? hData.length : typeof hData);
        if (Array.isArray(hData)) {
          headmanStudents = hData;
        }
      } else {
        console.warn(`[BSUIR Auth] /headman/students returned status ${hRes.status}`);
      }
    } catch (e) {
      console.warn('[BSUIR Auth] Error calling /headman/students:', e.message);
    }

    // Full Name resolution
    let fullName = '';
    if (profileData.fio && profileData.fio.trim()) {
      fullName = profileData.fio.trim();
    } else if (profileData.lastName || profileData.firstName) {
      fullName = `${profileData.lastName || ''} ${profileData.firstName || ''} ${profileData.middleName || ''}`.trim();
    } else if (loginData.fio && loginData.fio.trim()) {
      fullName = loginData.fio.trim();
    } else if (loginData.lastName || loginData.firstName) {
      fullName = `${loginData.lastName || ''} ${loginData.firstName || ''} ${loginData.middleName || ''}`.trim();
    }

    // Student Group resolution
    let groupNumber = '';
    if (groupData) {
      if (typeof groupData === 'string' && /^\d{6}$/.test(groupData.trim())) {
        groupNumber = groupData.trim();
      } else if (groupData.name && /^\d{6}$/.test(String(groupData.name).trim())) {
        groupNumber = String(groupData.name).trim();
      } else if (groupData.groupNumber) {
        groupNumber = String(groupData.groupNumber).trim();
      } else if (groupData.studentGroupDto && groupData.studentGroupDto.name) {
        groupNumber = String(groupData.studentGroupDto.name).trim();
      }
    }

    if (!groupNumber && profileData) {
      if (typeof profileData.studentGroup === 'string' && /^\d{6}$/.test(profileData.studentGroup.trim())) {
        groupNumber = profileData.studentGroup.trim();
      } else if (profileData.studentGroup && profileData.studentGroup.name) {
        groupNumber = String(profileData.studentGroup.name).trim();
      } else if (profileData.studentGroupDto && profileData.studentGroupDto.name) {
        groupNumber = String(profileData.studentGroupDto.name).trim();
      } else if (profileData.groupNumber) {
        groupNumber = String(profileData.groupNumber).trim();
      } else if (profileData.groupName) {
        groupNumber = String(profileData.groupName).trim();
      }
    }

    if (!groupNumber && loginData) {
      if (loginData.studentGroupDto && loginData.studentGroupDto.name) {
        groupNumber = String(loginData.studentGroupDto.name).trim();
      } else if (loginData.groupNumber) {
        groupNumber = String(loginData.groupNumber).trim();
      }
    }

    // Student Card / Record Book number
    let studentCardNumber = cleanUsername;
    if (profileData.studentCardNumber) {
      studentCardNumber = String(profileData.studentCardNumber).trim();
    } else if (profileData.studentCard) {
      studentCardNumber = String(profileData.studentCard).trim();
    } else if (profileData.numberOfBook) {
      studentCardNumber = String(profileData.numberOfBook).trim();
    } else if (profileData.recordBookNumber) {
      studentCardNumber = String(profileData.recordBookNumber).trim();
    }

    // Additional metadata
    const faculty = groupData.facultyAbbrev || profileData.faculty || loginData.faculty || '';
    const course = groupData.course || profileData.course || loginData.course || 0;
    const speciality = groupData.specialityName || groupData.specialityAbbrev || profileData.speciality || '';

    // Extract student roster from headman or groupInfoStudentDto
    let rawRoster = [];
    if (headmanStudents.length > 0) {
      rawRoster = headmanStudents;
    } else if (groupData) {
      const dto = groupData.groupInfoStudentDto || groupData.students || groupData.groupStudents;
      if (Array.isArray(dto)) {
        rawRoster = dto;
      } else if (dto && typeof dto === 'object') {
        rawRoster = Object.values(dto);
      }
    }

    // Normalize student items
    const groupStudents = rawRoster.map(s => {
      let name = '';
      if (s.fio && s.fio.trim()) {
        name = s.fio.trim();
      } else if (s.fullName && s.fullName.trim()) {
        name = s.fullName.trim();
      } else if (s.lastName || s.firstName) {
        name = `${s.lastName || ''} ${s.firstName || ''} ${s.middleName || ''}`.trim();
      }

      const subgroup = typeof s.subgroup === 'number' ? s.subgroup : 0;
      const isHeadman = s.position === 'Староста группы' || s.headman === true;
      const isDeputy = s.position === 'Заместитель старосты группы' || s.viceHeadman === true;

      return {
        id: s.id || null,
        fullName: name,
        subgroup,
        isHeadman,
        isDeputy
      };
    }).filter(s => s.fullName && s.fullName.length > 1);

    console.log(`[BSUIR Auth] Successfully extracted ${groupStudents.length} students for group ${groupNumber || 'unknown'}`);

    return {
      success: true,
      rawData: { login: loginData, profile: profileData, group: groupData, headman: headmanStudents },
      groupStudents,
      profile: {
        username: cleanUsername,
        fullName,
        groupNumber,
        studentCardNumber,
        faculty,
        course,
        speciality
      }
    };
  } catch (err) {
    console.error('[BSUIR Auth Error]:', err.message);
    return { success: false, error: 'Не удалось связаться с сервером ИИС БГУИР: ' + err.message };
  }
}
